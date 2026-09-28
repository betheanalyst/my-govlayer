"use client";

import type { Tone } from "@/domain/labels";
import type { WriteReport } from "@/domain/writeReport";
import type { AppError } from "@/lib/errors";
import { StateBadge } from "@/components/shared/StateBadge";
import { Panel } from "@/components/shared/Primitives";
import { Reveal } from "@/components/shared/Motion";

/**
 * Transaction result (Experience Blueprint section 12, "Transaction failure").
 *
 * Every write reports four things: what was attempted, what the wallet/network
 * did, whether protocol state changed, and what happens next. A finalized
 * transaction is never presented as a successful operation, and the raw recorded
 * message is always available one level down rather than replacing the human
 * explanation.
 */

const KIND_TONES: Record<WriteReport["kind"], Tone> = {
  confirmed: "positive",
  execution_failed: "review-negative",
  not_finalized: "caution",
  submission_failed: "neutral",
  not_attempted: "unknown",
};

export function WriteResultPanel({
  report,
  error,
  pending,
  pendingMessage,
}: {
  readonly report?: WriteReport | null;
  readonly error?: AppError | null;
  readonly pending?: boolean;
  readonly pendingMessage?: string;
}) {
  /**
   * Keyed so that each new outcome is a fresh element: the appearance of a
   * recorded result is the one place motion is used, and it says "this is new"
   * rather than implying that anything is still happening.
   */
  const stateKey =
    pending === true
      ? "pending"
      : error !== undefined && error !== null
        ? "error"
        : report !== undefined && report !== null
          ? `report-${report.kind}-${report.hash ?? "no-hash"}`
          : "idle";

  return (
    <Reveal key={stateKey}>
      <WriteResultBody
        report={report}
        error={error}
        pending={pending}
        pendingMessage={pendingMessage}
      />
    </Reveal>
  );
}

function WriteResultBody({
  report,
  error,
  pending,
  pendingMessage,
}: {
  readonly report?: WriteReport | null;
  readonly error?: AppError | null;
  readonly pending?: boolean;
  readonly pendingMessage?: string;
}) {
  if (pending === true) {
    return (
      <Panel tone="sunken" ariaLive="polite">
        <p className="flex items-center gap-3 text-sm text-ink">
          <span
            aria-hidden="true"
            className="h-2 w-2 animate-pulse rounded-full bg-accent"
          />
          {pendingMessage ?? "Waiting for the network to confirm this transaction…"}
        </p>
        <p className="mt-2 max-w-prose text-xs text-ink-subtle">
          Nothing is assumed while this runs. A transaction that runs a
          constitutional review takes as long as the network takes, and this
          interface reports the outcome the network recorded, not the outcome that
          was intended.
        </p>
      </Panel>
    );
  }

  if (error !== undefined && error !== null) {
    return (
      <Panel tone="sunken" ariaLive="polite">
        <StateBadge label={error.kind === "wallet" ? "Wallet" : "Failed"} tone={error.kind === "wallet" ? "unknown" : "review-negative"} />
        <p className="mt-3 max-w-prose text-sm text-ink">{error.message}</p>
        {error.nextStep === undefined ? null : (
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            {error.nextStep}
          </p>
        )}
        {error.raw === undefined ? null : (
          <TechnicalDetail label="Recorded message" value={error.raw} />
        )}
      </Panel>
    );
  }

  if (report === undefined || report === null) return null;

  return (
    <Panel tone="sunken" ariaLive="polite">
      <div className="flex flex-wrap items-center gap-3">
        <StateBadge label={report.headline} tone={KIND_TONES[report.kind]} />
        <span className="text-xs text-ink-subtle">{report.action}</span>
      </div>

      <p className="mt-3 max-w-prose text-sm text-ink">{report.detail}</p>

      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-ink-subtle">Protocol state changed:</dt>
          <dd className="text-ink">
            {report.recorded
              ? "Yes — the contract executed and recorded a change."
              : "No change is claimed."}
          </dd>
        </div>
      </dl>

      {report.observed === null ? null : (
        <p className="mt-3 max-w-prose text-sm text-ink-muted">{report.observed}</p>
      )}

      {report.error === null ? null : (
        <div className="mt-3">
          <p className="max-w-prose text-sm text-state-review-rejected">
            {report.error.message}
          </p>
          {report.error.nextStep === undefined ? null : (
            <p className="mt-1 max-w-prose text-xs text-ink-subtle">
              {report.error.nextStep}
            </p>
          )}
          {report.error.raw === undefined ? null : (
            <TechnicalDetail
              label="Recorded contract message"
              value={report.error.raw}
            />
          )}
        </div>
      )}

      {report.hash === null ? null : (
        <TechnicalDetail label="Transaction" value={report.hash} />
      )}
    </Panel>
  );
}

function TechnicalDetail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs text-ink-subtle">
        {label}
      </summary>
      <p className="code-value mt-2 break-all text-xs text-ink-muted">{value}</p>
    </details>
  );
}
