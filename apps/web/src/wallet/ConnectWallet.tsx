"use client";

import { shortenAddress } from "@/lib/hex";
import { cn } from "@/lib/cn";
import { useWallet } from "./WalletProvider";

/**
 * Wallet controls (Foundation Standard section 2.4).
 *
 * The product supplies its own connect UI and does not ask for credentials of
 * any kind. Browsing never requires this control, so it is deliberately quiet:
 * a single button, an address once connected, and an explicit statement when the
 * wallet's network does not match the deployment.
 */

export function ConnectWallet({ className }: { readonly className?: string }) {
  const wallet = useWallet();

  if (wallet.status === "detecting") {
    return (
      <span className={cn("text-sm text-ink-subtle", className)}>
        Checking wallet…
      </span>
    );
  }

  if (wallet.status === "connected" && wallet.address !== null) {
    return (
      <span className={cn("flex items-center gap-3", className)}>
        <span className="flex items-center gap-2 text-sm text-ink">
          <span
            aria-hidden="true"
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              wallet.chainMismatch ? "bg-caution" : "bg-positive",
            )}
          />
          <span className="code-value">{shortenAddress(wallet.address)}</span>
        </span>
        <button
          type="button"
          onClick={wallet.disconnect}
          className="text-sm text-ink-muted underline hover:text-ink"
        >
          Stop using this account
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void wallet.connect()}
      disabled={wallet.status === "connecting" || wallet.status === "unavailable"}
      className={cn(
        "rounded-card border border-line-control px-3.5 py-1.5 text-sm text-ink transition-colors duration-state",
        wallet.status === "unavailable"
          ? "cursor-not-allowed border-line text-ink-subtle"
          : "hover:border-ink-muted",
        className,
      )}
    >
      {wallet.status === "connecting"
        ? "Connecting…"
        : wallet.status === "unavailable"
          ? "No wallet available"
          : "Connect wallet"}
    </button>
  );
}

/**
 * The honest state of a participation surface for the current wallet.
 *
 * Shows why an action cannot be attempted right now, and never presents a wallet
 * or network problem as an eligibility or protocol answer.
 */
export function WalletRequirementNotice({
  action,
  className,
}: {
  /** What the person was trying to do, in a short phrase. */
  readonly action: string;
  readonly className?: string;
}) {
  const wallet = useWallet();

  return (
    <div
      className={cn(
        "rounded-card border border-line bg-surface-sunken p-6",
        className,
      )}
    >
      <p className="text-sm font-medium text-ink">
        To {action} you need a connected wallet on this deployment&rsquo;s network.
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        {wallet.writeBlockedReason ??
          "Connect a wallet to continue. Browsing and verification never require one."}
      </p>

      {wallet.expectedChainId === null ? null : (
        <p className="mt-2 text-xs text-ink-subtle">
          This deployment expects chain id{" "}
          <span className="code-value">{wallet.expectedChainId}</span>
          {wallet.walletChainId === null ? null : (
            <>
              {" "}
              · your wallet reports{" "}
              <span className="code-value">{wallet.walletChainId}</span>
            </>
          )}
          .
        </p>
      )}

      {wallet.error === null ? null : (
        <p className="mt-3 max-w-prose text-sm text-state-review-rejected">
          {wallet.error.message}
          {wallet.error.nextStep === undefined ? null : (
            <span className="block text-xs text-ink-subtle">
              {wallet.error.nextStep}
            </span>
          )}
        </p>
      )}

      {wallet.status === "unavailable" || wallet.status === "disconnected" ? (
        <div className="mt-4">
          <ConnectWallet />
        </div>
      ) : null}

      <p className="mt-4 max-w-prose text-xs text-ink-subtle">
        This interface never asks for a private key or a recovery phrase, and it
        never signs anything on its own. Every transaction is approved inside your
        wallet.
      </p>
    </div>
  );
}
