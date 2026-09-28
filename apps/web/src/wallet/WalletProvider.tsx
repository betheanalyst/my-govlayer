"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createWalletConnection } from "@/adapters/client";
import type { ResolvedConnection } from "@/adapters/client";
import { inspectRuntimeConfig } from "@/config/env";
import { resolveNetwork } from "@/config/network";
import { AppError } from "@/lib/errors";
import {
  getInjectedProvider,
  readAccounts,
  readProviderChainId,
  requestAccounts,
  subscribeToProvider,
  walletUnavailable,
  withWallet,
  type Eip1193Provider,
} from "./eip1193";

/**
 * Wallet connection state.
 *
 * Reading and verification never require any of this (Blueprint: "connection
 * unlocks participation, not information"), so nothing here is loaded eagerly
 * and no connection prompt is shown on public surfaces.
 *
 * Two properties matter for correctness:
 *
 *  - the wallet's chain is verified here, because genlayer-js skips its own
 *    chain assertion for studio chains. A wallet on the wrong network would
 *    otherwise sign a transaction addressed to a contract that does not exist
 *    there, so writes are refused while the wallet's network is unverified or
 *    mismatched (fail closed);
 *  - the connection is created from the authorized address and the injected
 *    provider only. No key material is requested, stored, or derived.
 */

export type WalletStatus =
  | "detecting"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected";

export interface WalletState {
  readonly status: WalletStatus;
  readonly address: string | null;
  readonly walletChainId: number | null;
  readonly expectedChainId: number | null;
  /** True when the wallet reports a different chain than this deployment. */
  readonly chainMismatch: boolean;
  /**
   * Why a write cannot be attempted, in one sentence, or null when it can.
   * This is a wallet/network condition, never an eligibility judgement.
   */
  readonly writeBlockedReason: string | null;
  readonly error: AppError | null;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  /** Throws a typed wallet error when a write cannot be attempted. */
  readonly requireConnection: () => ResolvedConnection;
}

const WalletContext = createContext<WalletState | null>(null);

function expectedChainIdFor(): number | null {
  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) return null;
  return resolveNetwork(inspected.config.network).chain.id;
}

export function WalletProvider({ children }: { readonly children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("detecting");
  const [address, setAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);

  const expectedChainId = useMemo(() => expectedChainIdFor(), []);

  // Detect an injected provider and any authorization it already holds. This
  // reads state only: it never prompts, and never signs.
  useEffect(() => {
    const injected = getInjectedProvider();
    if (injected === null) {
      setStatus("unavailable");
      return;
    }

    setProvider(injected);

    let cancelled = false;

    void (async () => {
      try {
        const [accounts, chainId] = await Promise.all([
          readAccounts(injected),
          readProviderChainId(injected),
        ]);
        if (cancelled) return;
        setWalletChainId(chainId);
        if (accounts.length > 0) {
          setAddress(accounts[0] ?? null);
          setStatus("connected");
        } else {
          setStatus("disconnected");
        }
      } catch {
        if (cancelled) return;
        setStatus("disconnected");
      }
    })();

    const unsubscribe = subscribeToProvider(injected, {
      onAccountsChanged: (accounts) => {
        setAddress(accounts[0] ?? null);
        setError(null);
        setStatus(accounts.length > 0 ? "connected" : "disconnected");
      },
      onChainChanged: (chainId) => {
        setWalletChainId(chainId);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const connect = useCallback(async () => {
    const injected = provider ?? getInjectedProvider();
    if (injected === null) {
      setError(walletUnavailable());
      setStatus("unavailable");
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      const accounts = await withWallet(
        async () => {
          const granted = await requestAccounts(injected);
          if (granted.length === 0) {
            throw new AppError({
              kind: "wallet",
              message: "The wallet returned no authorized account.",
              nextStep: "Authorize an account in the wallet and try again.",
              recoverable: true,
            });
          }
          return granted;
        },
        "The wallet could not connect.",
      );

      setProvider(injected);
      setAddress(accounts[0] ?? null);
      setWalletChainId(await readProviderChainId(injected));
      setStatus("connected");
    } catch (failure) {
      setError(failure instanceof AppError ? failure : new AppError({
        kind: "wallet",
        message: "The wallet could not connect.",
        recoverable: true,
      }));
      setStatus("disconnected");
    }
  }, [provider]);

  const disconnect = useCallback(() => {
    // A dapp cannot revoke its own authorization; it can only stop using it.
    // Said plainly here so the UI never implies the wallet was disconnected.
    setAddress(null);
    setError(null);
    setStatus(provider === null ? "unavailable" : "disconnected");
  }, [provider]);



  const chainMismatch =
    address !== null &&
    walletChainId !== null &&
    expectedChainId !== null &&
    walletChainId !== expectedChainId;

  const writeBlockedReason = (() => {
    if (status === "unavailable") {
      return "No wallet provider is available in this browser, so nothing can be submitted from here.";
    }
    if (status === "detecting") {
      return "Checking for an available wallet provider.";
    }
    if (address === null) {
      return "Connect a wallet to take part. Browsing and verification need no wallet.";
    }
    if (expectedChainId === null) {
      return "This deployment's network configuration is incomplete, so a transaction cannot be addressed to it.";
    }
    if (walletChainId === null) {
      return "The wallet's network could not be verified, so this interface will not submit a transaction to an unverified network.";
    }
    if (chainMismatch) {
      return `The wallet reports chain ${walletChainId}, while this deployment is on chain ${expectedChainId}. A transaction sent now would be addressed to a contract that does not exist on that network.`;
    }
    return null;
  })();

  const connection = useMemo(() => {
    if (address === null || provider === null || writeBlockedReason !== null) {
      return null;
    }
    const inspected = inspectRuntimeConfig();
    if (!inspected.ok) return null;
    return createWalletConnection({ address, provider }, inspected.config);
  }, [address, provider, writeBlockedReason]);

  const requireConnection = useCallback((): ResolvedConnection => {
    if (connection === null) {
      throw new AppError({
        kind: "wallet",
        message:
          writeBlockedReason ??
          "This action requires a connected wallet on the deployment's network.",
        nextStep:
          address === null
            ? "Connect a wallet, then try the action again."
            : "Resolve the wallet's network before retrying.",
        recoverable: true,
      });
    }
    return connection;
  }, [connection, writeBlockedReason, address]);

  const value = useMemo<WalletState>(
    () => ({
      status,
      address,
      walletChainId,
      expectedChainId,
      chainMismatch,
      writeBlockedReason,
      error,
      connect,
      disconnect,
      requireConnection,
    }),
    [
      status,
      address,
      walletChainId,
      expectedChainId,
      chainMismatch,
      writeBlockedReason,
      error,
      connect,
      disconnect,
      requireConnection,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (context === null) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return context;
}
