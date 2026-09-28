import { ArrowRight } from "lucide-react";
import { proposalStatusLabel, proposalStatusTone } from "@/domain/labels";
import {
  deriveProposalStage,
  disputeStagesRemaining,
  summarizeProposal,
  type ProposalStage,
} from "@/domain/state";
import type { GovernanceConfig, Proposal } from "@/domain/types";
import { StateBadge } from "@/components/shared/StateBadge";
import { Panel, TimingNote } from "@/components/shared/Primitives";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/hex";

/**
 * The decision journey (Experience Blueprint sections 6 and 10.3).
 *
 * A continuous rail rather than disconnected panels: Proposal, Constitutional
 * review, Revision / Voting, Dispute, Determination, Record. The current position
 * is derived from recorded status -- never from an assumed sequence -- and steps
 * the proposal has not reached are labelled as such instead of being drawn as
 * completed.
 */

interface JourneyStep {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly state: "completed" | "current" | "not_reached";
}

const STEP_LABELS = [
  { key: "proposal", label: "Proposal" },
  { key: "review", label: "Constitutional review" },
  { key: "revision_voting", label: "Revision / voting" },
  { key: "dispute", label: "Dispute" },
  { key: "determination", label: "Determination" },
  { key: "record", label: "Record" },
] as const;

/** Position of the proposal on the rail, derived from its stage. */
function currentStepIndex(stage: ProposalStage): number {
  switch (stage) {
    case "review_rejected":
      return 1;
    case "needs_revision":
    case "voting_open":
    case "voting_closed_awaiting_finalization":
      return 2;
    case "dispute_reevaluation":
      return 3;
    case "awaiting_stewardship_confirmation":
      return 4;
    case "passed":
    case "failed":
    case "cancelled":
      return 5;
    default:
      return 0;
  }
}

function auditOutcomeLabel(proposal: Proposal): string {
  switch (proposal.aiAuditDecision) {
    case "accept":
      return "Accepted — eligible for voting";
    case "revise":
      return "Needs revision";
    case "reject":
      return "Rejected — does not comply";
    default:
      return proposal.aiAuditDecision === ""
        ? "No review decision recorded"
        : "Unrecognized review decision";
  }
}

function buildSteps(
  proposal: Proposal,
  config: GovernanceConfig,
  stage: ProposalStage,
): JourneyStep[] {
  const current = currentStepIndex(stage);
  const totalVotes = proposal.votesYes + proposal.votesNo;

  const details: Record<string, string> = {
    proposal: `Submitted by ${shortenAddress(proposal.proposer)}`,
    review: auditOutcomeLabel(proposal),
    revision_voting:
      proposal.status === "needs_revision"
        ? `Revision ${proposal.resubmissionCount} of ${config.maxResubmissions.toString()}`
        : stage === "voting_open"
          ? "Voting is open"
          : stage === "voting_closed_awaiting_finalization"
            ? "Voting has closed"
            : totalVotes > 0n
              ? "Voting took place"
              : "Not reached",
    dispute:
      proposal.disputeStage > 0
        ? `Stage ${proposal.disputeStage} of ${config.maxDisputeStagesCount.toString()}`
        : disputeStagesRemaining(proposal, config) > 0
          ? "Available only if review rejects the proposal"
          : "No further stages available",
    determination:
      stage === "failed"
        ? "Failed after voting closed"
        : stage === "passed"
          ? "Passed after voting closed"
          : stage === "awaiting_stewardship_confirmation"
            ? "Vote accepted — constitution confirmation required"
            : "Not reached",
    record: `Recorded status: ${proposalStatusLabel(proposal.status)}`,
  };

  return STEP_LABELS.map((step, index) => ({
    ...step,
    detail: details[step.key] ?? "",
    state:
      index < current ? "completed" : index === current ? "current" : "not_reached",
  }));
}
export function DecisionJourney({
  proposal,
  config,
  now,
}: {
  proposal: Proposal;
  config: GovernanceConfig;
  now: number;
}) {
  const stage = deriveProposalStage(proposal, now);
  const steps = buildSteps(proposal, config, stage);

  return (
    <ol aria-label="Decision journey">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;

        return (
          <li key={step.key} className="relative flex gap-4 pb-6 last:pb-0">
            {isLast ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[0.6875rem] top-6 h-full w-px",
                  step.state === "completed" ? "bg-ink-muted" : "bg-line-strong",
                )}
              />
            )}

            <span
              aria-hidden="true"
              className={cn(
                "z-10 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                step.state === "current" && "border-accent bg-accent",
                step.state === "completed" && "border-ink-muted bg-surface-raised",
                step.state === "not_reached" && "border-line-strong bg-surface",
              )}
            >
              {step.state === "completed" || step.state === "current" ? (
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    step.state === "current" ? "bg-surface" : "bg-ink-muted",
                  )}
                />
              ) : null}
            </span>

            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm",
                  step.state === "not_reached" ? "text-ink-subtle" : "text-ink",
                  step.state === "current" && "font-medium",
                )}
              >
                {step.label}
                {step.state === "current" ? (
                  <span className="ml-2 text-xs uppercase tracking-[0.14em] text-accent">
                    Current stage
                  </span>
                ) : null}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-sm",
                  step.state === "not_reached"
                    ? "text-ink-subtle"
                    : "text-ink-muted",
                )}
              >
                {step.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Current-state panel (Experience Blueprint section 10.3).
 *
 * Always answers: what happened, why we are here, what can I do, what happens
 * next, and whether anything is required of the reader. "Waiting" is stated
 * explicitly when no action is required.
 */
export function CurrentStatePanel({
  proposal,
  config,
  now,
}: {
  proposal: Proposal;
  config: GovernanceConfig;
  now: number;
}) {
  const stage = deriveProposalStage(proposal, now);
  const summary = summarizeProposal(proposal, config, now);

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3">
        <StateBadge
          label={proposalStatusLabel(proposal.status)}
          tone={proposalStatusTone(proposal.status)}
        />
        {proposal.proposalType === "constitution" ? (
          <span className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
            Constitution amendment
          </span>
        ) : null}
      </div>

      <h2 className="mt-4 text-2xl">{summary.headline}</h2>
      <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted">
        {summary.detail}
      </p>

      <div className="mt-5 border-t border-line pt-5">
        <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
          What happens next
        </p>
        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink">
          {summary.nextStep}
        </p>
        {summary.actionRequired === "none" ? (
          <p className="mt-3 text-sm text-ink-muted">
            No action is required from you.
          </p>
        ) : null}
      </div>

      {stage === "voting_open" || stage === "voting_closed_awaiting_finalization" ? (
        <div className="mt-5 border-t border-line pt-5">
          <TimingNote
            futureLabel="Voting closes in"
            pastLabel="Voting closed"
            at={proposal.votingClosesAt}
            now={now}
          />
          {stage === "voting_closed_awaiting_finalization" ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
              The outcome is recorded when someone finalizes the decision.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

