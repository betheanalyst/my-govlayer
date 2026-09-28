import { AppError, extractMessage } from "@/lib/errors";

/**
 * EIP-1193 wallet/provider boundary (Foundation Standard sections 2.4 and 6).
 *
 * genlayer-js routes signing methods (`eth_requestAccounts`,
 * `eth_sendTransaction`, `personal_sign`, ...) through a configured provider
 * whenever the client's `account` is a bare address. That is the supported
 * wallet mechanism, so this module talks to the injected provider directly and
 * no separate wallet abstraction stack is introduced.
 *
 * Nothing here ever asks for a private key or a seed phrase, and nothing here
 * signs anything by itself: every write is initiated by an explicit user action
 * and confirmed inside the wallet.
 *
 * The provider shape is declared structurally rather than imported, because
 * genlayer-js does not export its `EthereumProvider` type and viem types are
 * deliberately not part of the frontend's dependency surface.
 */

export interface Eip1193RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | Record<string, unknown>;
}

export interface Eip1193Provider {
  request(args: Eip1193RequestArguments): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
  isConnected?(): boolean;
}

interface ProviderCarrier {
  ethereum?: Eip1193Provider;
}

/** The injected provider, or null when the environment has none. */
export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;

  const candidate = (window as unknown as ProviderCarrier).ethereum;
  if (candidate === undefined || typeof candidate.request !== "function") {
    return null;
  }

  return candidate;
}

/**
 * Asks the wallet which accounts are already authorized. Never prompts: used on
 * load to reflect an existing authorization, which is not the same as signing.
 */
export async function readAccounts(provider: Eip1193Provider): Promise<string[]> {
  const result = await provider.request({ method: "eth_accounts" });
  return normalizeAccounts(result);
}

/**
 * Requests account access. This is the only call that may prompt the wallet,
 * and it is only ever made in response to an explicit user action.
 */
export async function requestAccounts(
  provider: Eip1193Provider,
): Promise<string[]> {
  const result = await provider.request({ method: "eth_requestAccounts" });
  return normalizeAccounts(result);
}

/** The wallet's own chain id, or null when it cannot be read. */
export async function readProviderChainId(
  provider: Eip1193Provider,
): Promise<number | null> {
  try {
    const result = await provider.request({ method: "eth_chainId" });
    return parseChainId(result);
  } catch {
    return null;
  }
}

/** Parses a hex or decimal chain id. Returns null for anything else. */
export function parseChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const parsed = trimmed.startsWith("0x")
    ? Number.parseInt(trimmed.slice(2), 16)
    : Number.parseInt(trimmed, 10);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" && /^0x[0-9a-fA-F]{40}$/.test(entry),
  );
}

/** EIP-1193 codes for a request the user declined or that is already pending. */
const USER_REJECTED = 4001;
const REQUEST_ALREADY_PENDING = -32002;

export function isUserRejection(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === USER_REJECTED || code === REQUEST_ALREADY_PENDING;
}

/**
 * No provider is present. Reported as a wallet problem, never as an eligibility
 * or protocol answer: browsing remains available without one.
 */
export function walletUnavailable(nextStep?: string): AppError {
  return new AppError({
    kind: "wallet",
    message: "No compatible wallet provider is available in this browser.",
    nextStep:
      nextStep ??
      "Browsing and verification work without a wallet. To take part, open this deployment in a browser with a wallet extension that can reach the configured network.",
    recoverable: true,
  });
}

/** The user declined in the wallet. Nothing was submitted. */
export function walletRejected(): AppError {
  return new AppError({
    kind: "wallet",
    message: "The wallet did not approve this request.",
    nextStep: "Nothing was submitted. Approve the request in the wallet to continue.",
    recoverable: true,
  });
}

/** Any other wallet/provider failure. The recorded message is preserved. */
export function walletFailure(error: unknown, message?: string): AppError {
  return new AppError({
    kind: "wallet",
    message: message ?? "The wallet could not complete this request.",
    nextStep: "Nothing was confirmed as submitted. Check the wallet and try again.",
    recoverable: true,
    raw: extractMessage(error),
    cause: error,
  });
}

/**
 * Wraps a provider interaction, converting wallet failures into typed errors.
 * A user rejection stays explicit so the UI can say the request was declined
 * rather than presenting it as a protocol problem.
 */
export async function withWallet<T>(
  operation: () => Promise<T>,
  fallbackMessage?: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUserRejection(error)) throw walletRejected();
    throw walletFailure(error, fallbackMessage);
  }
}

export interface ProviderEvents {
  readonly onAccountsChanged: (accounts: readonly string[]) => void;
  readonly onChainChanged: (chainId: number | null) => void;
}

/**
 * Subscribes to the two events that can invalidate a connection. Providers are
 * not required to support subscriptions, so absence is handled silently --
 * connection state is re-read on demand instead.
 */
export function subscribeToProvider(
  provider: Eip1193Provider,
  events: ProviderEvents,
): () => void {
  if (typeof provider.on !== "function") return () => undefined;

  const accountsListener = (...args: never[]) => {
    events.onAccountsChanged(normalizeAccounts(args[0]));
  };
  const chainListener = (...args: never[]) => {
    events.onChainChanged(parseChainId(args[0]));
  };

  provider.on("accountsChanged", accountsListener);
  provider.on("chainChanged", chainListener);

  return () => {
    if (typeof provider.removeListener !== "function") return;
    provider.removeListener("accountsChanged", accountsListener);
    provider.removeListener("chainChanged", chainListener);
  };
}

