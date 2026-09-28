import Link from "next/link";
import { adminActionTypeLabel } from "@/domain/labels";
import {
  governanceEventLabel,
  parseAdminActionAppliedDetails,
  parseConstitutionAppliedDetails,
  parseProposalCreatedDetails,
  parsePullRejectedDetails,
} from "@/domain/events";
import type { GovernanceEvent } from "@/domain/types";
import { Panel, RecordedText, SectionHeading } from "@/components/shared/Primitives";
import { formatUtcTimestamp } from "@/lib/time";
import { shortenAddress } from "@/lib/hex";

/**
 * The Record (Experience Blueprint sections 6 and 10.3).
 *
 * The timeline is the contract's own governance history, filtered to this
 * proposal. Where a recorded `details` string follows a known layout it is parsed
 * into readable facts; otherwise the recorded string is shown verbatim, so no
 * entry is invented, reworded, or silently dropped.
 */

function describeEvent(event: GovernanceEvent): {
  readonly primary: string;
  readonly secondary?: string;
} {
  switch (event.eventType) {
    case "proposal_created": {
      const parsed = parseProposalCreatedDetails(event.details);
      return parsed === null
        ? { primary: "Proposal submitted" }
        : {
            primary: "Proposal submitted",
            secondary: `${parsed.proposalType} · review ${parsed.auditDecision} · status ${parsed.initialStatus}`,
          };
    }
    case "admin_action_applied": {
      const parsed = parseAdminActionAppliedDetails(event.details);
      return parsed === null
        ? { primary: "Authorized action applied to Core" }
        : {
            primary: `${adminActionTypeLabel(parsed.actionType)} applied to Core`,
            secondary: parsed.actionId,
          };
    }
    case "admin_action_pull_rejected": {
      const parsed = parsePullRejectedDetails(event.details);
      return parsed === null
        ? { primary: "Authorized action rejected by Core" }
        : {
            primary: `${adminActionTypeLabel(parsed.actionType)} rejected by Core`,
            secondary: `${parsed.actionId} — ${parsed.reason}`,
          };
    }
    case "constitution_update_applied": {
      const parsed = parseConstitutionAppliedDetails(event.details);
      return parsed === null
        ? { primary: "Constitution updated" }
        : {
            primary: `Constitution advanced to version ${parsed.version.toString()}`,
            secondary: `via ${parsed.actionId}, proposal #${parsed.proposalId.toString()}`,
          };
    }
    default:
      return { primary: governanceEventLabel(event.eventType) };
  }
}

export function RecordTimeline({
  events,
  historyTotal,
}: {
  events: readonly GovernanceEvent[];
  historyTotal: number;
}) {
  const chronological = [...events].reverse();

  return (
    <section aria-labelledby="record-heading" className="space-y-6">
      <SectionHeading
        id="record-heading"
        title="Record"
        description="Every lifecycle transition the contract recorded for this proposal, in the order it happened."
      />

      {chronological.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No lifecycle entries were found for this proposal in the scanned portion
          of the governance history.
        </p>
      ) : (
        <ol className="space-y-4">
          {chronological.map((event, index) => {
            const described = describeEvent(event);

            return (
              <li
                key={`${event.eventType}-${event.timestamp}-${index}`}
                className="border-l border-line pl-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-sm text-ink">{described.primary}</p>
                  <p className="text-xs text-ink-subtle">
                    {formatUtcTimestamp(event.timestamp)} UTC
                  </p>
                </div>
                {described.secondary === undefined ? null : (
                  <p className="mt-1 text-xs text-ink-muted">{described.secondary}</p>
                )}
                <p className="mt-1 text-xs text-ink-subtle">
                  actor {shortenAddress(event.actor)} ·{" "}
                  <span className="font-mono">{event.eventType}</span>
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-subtle hover:text-ink-muted">
                    Recorded entry
                  </summary>
                  <div className="mt-2">
                    <RecordedText value={event.details} />
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      {events.length < historyTotal ? (
        <p className="text-xs text-ink-subtle">
          Scope: this view reviews the most recent {events.length} of {historyTotal}{" "}
          governance history entries. The contract exposes history as one
          chronological log, so older entries are not searched from here.
        </p>
      ) : null}
    </section>
  );
}
/**
 * Verification layer (Experience Blueprint section 10.13).
 *
 * The human-readable summary comes first; the raw recorded fields sit one level
 * below, and the full record can be checked on the dedicated verification
 * surface.
 */
export function VerificationPanel({
  proposalId,
  rawStatus,
  rawFailureReason,
  rawAuditDecision,
  createdAt,
  votingClosesAt,
  contractAddress,
  networkLabel,
  rpcUrl,
}: {
  proposalId: string;
  rawStatus: string;
  rawFailureReason: string;
  rawAuditDecision: string;
  createdAt: number;
  votingClosesAt: number;
  contractAddress: string;
  networkLabel: string;
  rpcUrl: string;
}) {
  return (
    <section aria-labelledby="verify-heading" className="space-y-4">
      <SectionHeading
        id="verify-heading"
        title="Verification"
        description="What was recorded, and how to check it independently."
      />

      <Panel tone="sunken">
        <p className="text-sm text-ink-muted">
          This page reads proposal #{proposalId} directly from GovLayerCore on{" "}
          {networkLabel}. Every value shown here can be reproduced by reading the
          same contract, or through the{" "}
          <Link href={`/verify/${proposalId}`} className="underline">
            verification view
          </Link>
          .
        </p>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ink-subtle hover:text-ink-muted">
            Technical record
          </summary>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-subtle">Contract</dt>
              <dd className="code-value break-all">{contractAddress}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-subtle">RPC</dt>
              <dd className="code-value break-all">{rpcUrl}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-subtle">Raw status</dt>
              <dd className="code-value">{rawStatus}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-subtle">Raw review decision</dt>
              <dd className="code-value">
                {rawAuditDecision === "" ? "(empty)" : rawAuditDecision}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-subtle">Raw failure reason</dt>
              <dd className="code-value">
                {rawFailureReason === "" ? "(empty)" : rawFailureReason}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-subtle">Created at</dt>
              <dd className="code-value">
                {createdAt} ({formatUtcTimestamp(createdAt)} UTC)
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-subtle">Voting closes at</dt>
              <dd className="code-value">
                {votingClosesAt} ({formatUtcTimestamp(votingClosesAt)} UTC)
              </dd>
            </div>
          </dl>
        </details>
      </Panel>
    </section>
  );
}

