"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { formatDuration, formatUtcTimestamp } from "@/lib/time";
import { isAppError } from "@/lib/errors";
import { disputeEligibility } from "@/domain/state";
import { useGovernanceConfig, useProposal } from "@/queries/coreQueries";
import { useRaiseDispute } from "@/queries/writeHooks";
import { useWallet } from "@/wallet/WalletProvider";
import { WalletRequirementNotice } from "@/wallet/ConnectWallet";
import { PageHeader, Panel, SectionHeading } from "@/components/shared/Primitives";
import { WriteResultPanel } from "@/components/participation/WriteResultPanel";

/**
 * Raise a dispute (Experience Blueprint section 10.8).
 *
 * A dispute is a narrow constitutional reevaluation of a proposal that the
 * review rejected. This surface states what stays the same, what changes, and --
 * explicitly -- what a dispute does not do, before offering the action.
 */
export default function DisputeProposalPage() {
  const params = useParams<{ id: string }>();
  const wallet = useWallet();
  const proposalId = /^\d+$/.test(params.id) ? BigInt(params.id) : null;
  const proposal = useProposal(proposalId ?? 0n);
  const config = useGovernanceConfig();
  const dispute = useRaiseDispute();
  const [reason, setReason] = useState("");

  if (proposalId === null) return <NotFoundPanel />;

  if (proposal.isLoading) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Dispute" title="Loading the record…" />
      </main>
    );
  }

  if (proposal.isError || proposal.data === undefined) {
    if (isAppError(proposal.error) && proposal.error.kind === "not_found") {
      return <NotFoundPanel />;
    }
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Dispute" title="This record could not be read" />
        <p className="mt-6 max-w-prose text-sm text-ink-muted">
          The proposal could not be verified right now. This is not a statement
          about the proposal itself. Retry in a moment.
        </p>
      </main>
    );
  }

  const record = proposal.data;
  const governance = config.data;
  const now = Math.floor(Date.now() / 1000);
  const eligibility =
    governance === undefined
      ? null
      : disputeEligibility(record, governance, wallet.address ?? "", now);

  const reasonIssue = reason.trim() === "" ? "A dispute needs a reason." : null;
  const canAttempt =
    eligibility !== null &&
    (eligibility.state === "eligible_proposer" ||
      eligibility.state === "undetermined_voter");

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow={`Dispute · proposal #${record.proposalId.toString()}`}
        title={record.title}
        lede="A dispute asks for a fresh constitutional reevaluation. It is not an appeal to the community, and it is not a vote."
      >
        <p className="text-sm">
          <Link
            href={`/proposals/${record.proposalId.toString()}`}
            className="underline"
          >
            Back to the record
          </Link>
        </p>
      </PageHeader>

      {record.status !== "rejected" ? (
        <Panel tone="sunken" className="mt-10">
          <p className="max-w-prose text-sm text-ink">
            This proposal is recorded as{" "}
            <span className="code-value">{record.rawStatus}</span>. Only a proposal
            rejected in constitutional review can be disputed — a determination after
            a vote is a governance outcome, and the protocol provides no dispute for
            it.
          </p>
        </Panel>
      ) : null}

      {record.status === "rejected" ? (
        <div className="mt-10 space-y-14">
          <section aria-labelledby="what-heading" className="space-y-4">
            <SectionHeading
              id="what-heading"
              title="What a dispute does, and does not do"
              description="The scope is deliberately narrow."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Panel tone="sunken">
                <p className="text-sm font-medium text-ink">What stays the same</p>
                <ul className="mt-3 space-y-2 text-sm text-ink-muted">
                  <li>The original proposal.</li>
                  <li>The constitution snapshot captured at submission.</li>
                  <li>The underlying record.</li>
                </ul>
              </Panel>
              <Panel tone="sunken">
                <p className="text-sm font-medium text-ink">What changes</p>
                <ul className="mt-3 space-y-2 text-sm text-ink-muted">
                  <li>A fresh constitutional reevaluation.</li>
                  <li>
                    If it is accepted, a genuine voting window opens — for the
                    voting length originally chosen.
                  </li>
                </ul>
              </Panel>
              <Panel tone="sunken">
                <p className="text-sm font-medium text-ink">
                  What does not happen
                </p>
                <ul className="mt-3 space-y-2 text-sm text-ink-muted">
                  <li>A dispute does not approve the proposal.</li>
                  <li>A dispute does not finalize governance by itself.</li>
                  <li>
                    It does not change the constitution text the proposal was
                    measured against.
                  </li>
                </ul>
              </Panel>
            </div>
          </section>

          <section aria-labelledby="eligibility-heading" className="space-y-4">
            <SectionHeading
              id="eligibility-heading"
              title="Who may raise it"
              description="The proposer, or an address that voted on the proposal. The contract enforces this."
            />
            <Panel>
              {eligibility === null ? (
                <p className="text-sm text-ink-muted">
                  Reading this DAO&rsquo;s dispute rules…
                </p>
              ) : (
                <>
                  <p className="max-w-prose text-sm text-ink">
                    {disputeSummary(eligibility, record.proposalId.toString())}
                  </p>
                  <p className="mt-3 max-w-prose text-xs text-ink-subtle">
                    Stages used: {record.disputeStage} of{" "}
                    {governance?.maxDisputeStagesCount.toString() ?? "?"}. A cooldown
                    of{" "}
                    {governance === undefined
                      ? "?"
                      : formatDuration(governance.disputeCooldownSeconds)}{" "}
                    applies between stages, never to the first one.
                  </p>
                  {record.disputeHistory.length === 0 ? null : (
                    <ul className="mt-4 space-y-2 text-xs text-ink-muted">
                      {record.disputeHistory.map((entry) => (
                        <li key={`${entry.stage}-${entry.raisedAt}`}>
                          Stage {entry.stage} · {formatUtcTimestamp(entry.raisedAt)}{" "}
                          UTC · resolved as{" "}
                          <span className="code-value">{entry.resolution}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Panel>
          </section>

          <section aria-labelledby="reason-heading" className="space-y-4">
            <SectionHeading
              id="reason-heading"
              title="Why the assessment should be reconsidered"
              description="The reevaluation reads this alongside the proposal and the constitutional snapshot."
            />
            <Panel>
              {wallet.writeBlockedReason === null ? null : (
                <div className="mb-5">
                  <WalletRequirementNotice action="raise a dispute" />
                </div>
              )}

              <label htmlFor="reason" className="text-sm font-medium text-ink">
                Reason
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={8}
                className="mt-2 w-full rounded-card border border-line-control bg-surface-raised px-4 py-2.5 text-sm text-ink"
              />
              {reasonIssue === null ? null : (
                <p className="mt-1 text-xs text-state-review-rejected">
                  {reasonIssue}
                </p>
              )}

              <button
                type="button"
                disabled={
                  reasonIssue !== null ||
                  !canAttempt ||
                  dispute.isPending ||
                  wallet.writeBlockedReason !== null
                }
                onClick={() => {
                  void dispute
                    .mutateAsync({
                      proposalId: record.proposalId,
                      reason: reason.trim(),
                    })
                    .catch(() => undefined);
                }}
                className="mt-5 rounded-card bg-accent px-6 py-3 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {dispute.isPending ? "Waiting for the network…" : "Raise dispute"}
              </button>
              {dispute.isPending ? (
                <p className="mt-3 max-w-prose text-xs text-ink-subtle">
                  The reevaluation runs inside this transaction, so it takes as long
                  as the network takes.
                </p>
              ) : null}

              <div className="mt-5">
                <WriteResultPanel
                  pending={dispute.isPending}
                  report={dispute.data ?? null}
                  error={dispute.error ?? null}
                />
              </div>
            </Panel>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function disputeSummary(
  eligibility: NonNullable<ReturnType<typeof disputeEligibility>>,
  proposalId: string,
): string {
  switch (eligibility.state) {
    case "eligible_proposer":
      return `You submitted proposal #${proposalId}, so you may raise a dispute while stages remain and outside the cooldown.`;
    case "undetermined_voter":
      return "You did not submit this proposal. A dispute from another address requires a recorded vote on it, and GovLayerCore keeps the tally rather than the voter — so this interface cannot tell whether your address voted, and will not guess. Attempting is safe: the contract accepts or refuses it.";
    case "cooldown":
      return `A dispute cooldown is active. The next dispute becomes available ${formatUtcTimestamp(eligibility.nextAllowedAt)} UTC (in ${formatDuration(eligibility.remainingSeconds)}).`;
    case "stages_exhausted":
      return "All dispute stages for this proposal have been used, so no further dispute is possible.";
    case "not_rejected":
      return "Only a proposal rejected in constitutional review can be disputed.";
  }
}

function NotFoundPanel() {
  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Dispute"
        title="No record here"
        lede="Nothing on chain matches that proposal number, so there is no assessment to dispute."
      />
      <p className="mt-6 text-sm">
        <Link href="/explore" className="underline">
          Browse the governance record
        </Link>
      </p>
    </main>
  );
}

