import { formatRatioPercent } from "@/lib/format";
import type {
  GovernanceConfig,
  PendingAdminAction,
  Proposal,
} from "./types";

/**
 * Derived protocol state.
 *
 * Everything here is *derived* from contract values (Foundation Standard
 * section 2.9) -- never a substitute for them, and never an invented protocol
 * concept. Two rules govern the whole module:
 *
 *   1. `rejected` (a constitutional-review outcome) and `failed` (a post-vote
 *      governance outcome) never collapse into the same state.
 *   2. Where the contracts expose no data, the result says so instead of
 *      guessing. In particular GovLayerCore has no per-voter view, so voter
 *      eligibility for a dispute cannot be determined by reading -- that case is
 *      represented explicitly (`undetermined_voter`), not assumed.
 */

/** Where a proposal stands, expressed in the protocol's own terms. */
export type ProposalStage =
  | "review_rejected"
  | "needs_revision"
  | "voting_open"
  | "voting_closed_awaiting_finalization"
  | "dispute_reevaluation"
  | "awaiting_stewardship_confirmation"
  | "passed"
  | "failed"
  | "cancelled"
  | "unrecognized";

/**
 * Derives the current stage.
 *
 * `pending` means the constitutional review already completed and voting is
 * open (the initial audit runs inside the submission transaction itself), so
 * "review in progress" is never claimed for a pending proposal. `under_review`
 * is the dispute reevaluation stage, not the initial review.
 */
export function deriveProposalStage(
  proposal: Proposal,
  now: number,
): ProposalStage {
  switch (proposal.status) {
    case "rejected":
      return "review_rejected";
    case "needs_revision":
      return "needs_revision";
    case "under_review":
      return "dispute_reevaluation";
    case "pending_constitution_confirm":
      return "awaiting_stewardship_confirmation";
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
      // The contract closes voting with `now > voting_closes_at`.
      return now > proposal.votingClosesAt
        ? "voting_closed_awaiting_finalization"
        : "voting_open";
    default:
      return "unrecognized";
  }
}

/** Voting is open: status `pending` and the deadline has not passed. */
export function isVotingOpen(proposal: Proposal, now: number): boolean {
  return proposal.status === "pending" && now <= proposal.votingClosesAt;
}

/** Voting has closed but the outcome has not been finalized yet. */
export function isVotingClosed(proposal: Proposal, now: number): boolean {
  return proposal.status === "pending" && now > proposal.votingClosesAt;
}

/**
 * Any address may finalize once the window has closed (permissionless).
 * The contract requires the deadline to have strictly passed.
 */
export function canFinalize(proposal: Proposal, now: number): boolean {
  return isVotingClosed(proposal, now);
}
/**
 * The protocol-state half of vote eligibility.
 *
 * Whether *this* address may vote additionally depends on eligibility
 * configuration and on whether it has already voted. The contracts expose no
 * per-address vote record, so "already voted" cannot be read: it is discovered
 * by the contract rejecting a second attempt (votes are immutable).
 */
export function canVote(proposal: Proposal, now: number): boolean {
  return isVotingOpen(proposal, now);
}

export function isProposer(proposal: Proposal, address: string): boolean {
  return proposal.proposer.toLowerCase() === address.trim().toLowerCase();
}

/** Proposer-only; needs `isProposer` to be true for the caller. */
export function canResubmit(
  proposal: Proposal,
  config: GovernanceConfig,
): boolean {
  return (
    proposal.status === "needs_revision" &&
    BigInt(proposal.resubmissionCount) < config.maxResubmissions
  );
}

/** Proposer-only; needs `isProposer` to be true for the caller. */
export function canCancel(proposal: Proposal): boolean {
  return proposal.status === "pending" || proposal.status === "needs_revision";
}

/** Dispute stages still available, from the contract's own counters. */
export function disputeStagesRemaining(
  proposal: Proposal,
  config: GovernanceConfig,
): number {
  const remaining = Number(config.maxDisputeStagesCount) - proposal.disputeStage;
  return remaining > 0 ? remaining : 0;
}

/**
 * Seconds until another dispute stage may be raised, or null when none is
 * pending. The contract applies the cooldown *between stages* only, so a first
 * dispute is never cooldown-gated.
 */
export function disputeCooldownRemaining(
  proposal: Proposal,
  config: GovernanceConfig,
  now: number,
): number | null {
  const last = proposal.disputeHistory.at(-1);
  if (last === undefined) return null;

  const allowedAt = last.raisedAt + config.disputeCooldownSeconds;
  return now >= allowedAt ? null : allowedAt - now;
}

/**
 * Whether the connected address can raise a dispute, as far as the contract can
 * be read.
 *
 * - the proposer's eligibility is fully determined;
 * - a non-proposer can only dispute if it recorded a vote on this proposal, and
 *   GovLayerCore exposes no per-voter record -- so that case is
 *   `undetermined_voter`, never assumed eligible or ineligible.
 */
export type DisputeEligibility =
  | { readonly state: "not_rejected" }
  | { readonly state: "stages_exhausted" }
  | {
      readonly state: "cooldown";
      readonly nextAllowedAt: number;
      readonly remainingSeconds: number;
    }
  | { readonly state: "eligible_proposer" }
  | { readonly state: "undetermined_voter" };

export function disputeEligibility(
  proposal: Proposal,
  config: GovernanceConfig,
  address: string,
  now: number,
): DisputeEligibility {
  if (proposal.status !== "rejected") {
    return { state: "not_rejected" };
  }

  if (disputeStagesRemaining(proposal, config) === 0) {
    return { state: "stages_exhausted" };
  }

  const cooldown = disputeCooldownRemaining(proposal, config, now);
  if (cooldown !== null) {
    return {
      state: "cooldown",
      nextAllowedAt: now + cooldown,
      remainingSeconds: cooldown,
    };
  }

  return isProposer(proposal, address)
    ? { state: "eligible_proposer" }
    : { state: "undetermined_voter" };
}
export interface VoteTallies {
  readonly yes: bigint;
  readonly no: bigint;
  readonly recorded: bigint;
  /**
   * True when `voting_weight_mode` is `token_weighted`: the tallies are sums of
   * voting weight, not counts of votes.
   */
  readonly weighted: boolean;
}

export function voteTallies(
  proposal: Proposal,
  config: GovernanceConfig,
): VoteTallies {
  return {
    yes: proposal.votesYes,
    no: proposal.votesNo,
    recorded: proposal.votesYes + proposal.votesNo,
    weighted: config.votingWeightMode === "token_weighted",
  };
}

export interface QuorumStatus {
  readonly required: bigint;
  readonly recorded: bigint;
  readonly met: boolean;
}

/**
 * Quorum as the contract applies it: the *recorded total* (a weighted sum when
 * token-weighted voting is configured) compared against `min_quorum`.
 */
export function quorumStatus(
  proposal: Proposal,
  config: GovernanceConfig,
): QuorumStatus {
  const recorded = proposal.votesYes + proposal.votesNo;
  return {
    required: config.minQuorum,
    recorded,
    met: recorded >= config.minQuorum,
  };
}

export interface ApprovalStatus {
  readonly yes: bigint;
  readonly no: bigint;
  /**
   * Approval percentage using the contract's own integer floor division
   * (`votes_yes * 100 // total_votes`), so the displayed figure matches the
   * value the contract records in its determination log.
   */
  readonly approvalPercent: bigint | null;
  readonly thresholdPercent: bigint;
  readonly met: boolean;
  readonly weighted: boolean;
}

export function approvalStatus(
  proposal: Proposal,
  config: GovernanceConfig,
): ApprovalStatus {
  const total = proposal.votesYes + proposal.votesNo;
  const approvalPercent =
    total === 0n ? null : (proposal.votesYes * 100n) / total;

  return {
    yes: proposal.votesYes,
    no: proposal.votesNo,
    approvalPercent,
    thresholdPercent: config.approvalThresholdPercent,
    met:
      approvalPercent !== null &&
      approvalPercent >= config.approvalThresholdPercent,
    weighted: config.votingWeightMode === "token_weighted",
  };
}

/** Rounded rendering for visualisation only; `approvalStatus` carries the exact value. */
export function approvalPercentText(status: ApprovalStatus): string | null {
  return formatRatioPercent(status.yes, status.yes + status.no);
}

/**
 * Plain-language explanation of a recorded failure reason. Returns null for an
 * empty or unrecognised value rather than inventing a cause.
 */
export function describeFailureReason(reason: string): string | null {
  if (reason === "quorum_not_met") return "Quorum was not met";
  if (reason === "threshold_not_met") return "The approval threshold was not met";
  return null;
}
export interface ProposalStateSummary {
  readonly stage: ProposalStage;
  readonly headline: string;
  readonly detail: string;
  readonly nextStep: string;
  /**
   * Whether the protocol permits any action in this state. It says nothing
   * about whether *this* visitor is permitted to take it.
   */
  readonly actionRequired: "none" | "possible";
}

/**
 * Human-readable state framing, derived strictly from recorded protocol state.
 *
 * Experience Blueprint section 11 ("State -> UI behavior") and Non-Negotiable
 * UX Requirement 12 (every meaningful state says what happens next, or that no
 * action is required). No stage is described using another stage's vocabulary:
 * a review rejection is never described as a vote outcome, and a post-vote
 * failure is never described as a rejection.
 */
export function summarizeProposal(
  proposal: Proposal,
  config: GovernanceConfig,
  now: number,
): ProposalStateSummary {
  const stage = deriveProposalStage(proposal, now);

  switch (stage) {
    case "review_rejected":
      return {
        stage,
        headline: "Rejected in constitutional review",
        detail:
          "Constitutional review determined that this proposal does not comply with the constitution. This is a review outcome, not a community vote.",
        nextStep:
          "The proposer, or an address that voted on this proposal, may raise a dispute while stages remain.",
        actionRequired:
          disputeStagesRemaining(proposal, config) > 0 ? "possible" : "none",
      };

    case "needs_revision":
      return {
        stage,
        headline: "Needs revision",
        detail:
          "Constitutional review found the proposal fundamentally sound but in need of clarification.",
        nextStep:
          "The proposer can revise the description and resubmit it for a fresh constitutional review.",
        actionRequired: canResubmit(proposal, config) ? "possible" : "none",
      };

    case "voting_open":
      return {
        stage,
        headline: "Voting open",
        detail:
          "Constitutional review accepted this proposal and the voting window is open.",
        nextStep:
          "Eligible participants can vote; votes are immutable once recorded. The outcome becomes determinable after the deadline passes.",
        actionRequired: "possible",
      };

    case "voting_closed_awaiting_finalization":
      return {
        stage,
        headline: "Voting closed — awaiting determination",
        detail:
          "The voting window has closed, but the outcome has not been finalized on chain yet.",
        nextStep:
          "Anyone can finalize the decision, which records the outcome as protocol state.",
        actionRequired: "possible",
      };

    case "dispute_reevaluation":
      return {
        stage,
        headline: "Dispute reevaluation in progress",
        detail:
          "A dispute was raised and this proposal is being reevaluated against the constitution snapshot captured at its submission.",
        nextStep:
          "If the dispute is accepted, a fresh voting window opens. If it is not, the proposal stays rejected.",
        actionRequired: "none",
      };

    case "awaiting_stewardship_confirmation":
      return {
        stage,
        headline: "Awaiting stewardship confirmation",
        detail:
          "The vote accepted this constitution amendment. Applying it requires an authorized stewardship action, which GovLayerCore independently validates before applying.",
        nextStep:
          "Stewards propose, approve and execute the confirmation; GovLayerCore then applies it and records the new constitution version.",
        actionRequired: "possible",
      };

    case "passed":
      return {
        stage,
        headline: "Passed",
        detail:
          "This proposal met the configured quorum and approval threshold. The outcome is final.",
        nextStep: "No further action is required.",
        actionRequired: "none",
      };

    case "failed": {
      const reason = describeFailureReason(proposal.failureReason);
      return {
        stage,
        headline: "Failed",
        detail:
          reason === null
            ? "This proposal did not meet the configured governance requirements after voting closed."
            : `${reason} after voting closed.`,
        nextStep:
          "This is a governance outcome rather than a constitutional-review outcome, and it cannot be disputed.",
        actionRequired: "none",
      };
    }

    case "cancelled":
      return {
        stage,
        headline: "Cancelled",
        detail:
          "The proposer cancelled this proposal before its voting window closed.",
        nextStep: "The record is preserved.",
        actionRequired: "none",
      };

    default:
      return {
        stage: "unrecognized",
        headline: "Unrecognized state",
        detail: `This interface does not recognise the recorded status "${proposal.rawStatus}". It is shown exactly as recorded rather than mapped onto a known outcome.`,
        nextStep: "Inspect the record on chain to confirm the current state.",
        actionRequired: "none",
      };
  }
}
// -- Protocol stewardship -----------------------------------------------------

/** Where an authorized action stands on GovLayerAdmin. */
export type AdminActionStage =
  | "awaiting_approvals"
  | "awaiting_timelock"
  | "ready_to_execute"
  | "executed"
  | "expired"
  | "unrecognized";

type ActionProgressShape = Pick<
  PendingAdminAction,
  "status" | "readyAt" | "validApprovalsNow"
>;

export function deriveAdminActionStage(
  action: Pick<ActionProgressShape, "status" | "readyAt">,
  now: number,
): AdminActionStage {
  switch (action.status) {
    case "pending_approvals":
      return "awaiting_approvals";
    case "timelocked":
      return now >= action.readyAt ? "ready_to_execute" : "awaiting_timelock";
    case "executed":
      return "executed";
    case "expired":
      return "expired";
    default:
      return "unrecognized";
  }
}

export interface ApprovalProgress {
  readonly recorded: number;
  readonly required: number;
  readonly met: boolean;
}

/**
 * Approval progress. `get_pending_actions` does not return the action's
 * threshold, so callers pass the current one (from `get_current_threshold` or
 * the action's own `current_threshold`).
 */
export function approvalProgress(
  action: Pick<ActionProgressShape, "validApprovalsNow">,
  required: number,
): ApprovalProgress {
  return {
    recorded: action.validApprovalsNow,
    required,
    met: action.validApprovalsNow >= required,
  };
}

/** Seconds until an action becomes executable, or null when it is not timelocked. */
export function timelockRemaining(
  action: Pick<ActionProgressShape, "status" | "readyAt">,
  now: number,
): number | null {
  if (action.status !== "timelocked") return null;
  return now >= action.readyAt ? null : action.readyAt - now;
}

/**
 * The Admin-authorizes / Core-applies boundary as one state.
 *
 * `executed` on GovLayerAdmin is authorization only. GovLayerCore decides
 * afterwards, and a rejected pull is permanent. "Applied" is reported only when
 * Core actually records the action.
 */
export type ApplicationState =
  | "awaiting_execution"
  | "awaiting_application"
  | "applied"
  | "pull_rejected"
  | "expired"
  | "unrecognized";

export function deriveApplicationState(input: {
  readonly action: Pick<ActionProgressShape, "status">;
  /** From `is_admin_action_applied` on GovLayerCore. */
  readonly appliedToCore: boolean;
  /** From a recorded `admin_action_pull_rejected` entry for this action. */
  readonly pullRejected: boolean;
}): ApplicationState {
  if (input.pullRejected) return "pull_rejected";
  if (input.appliedToCore) return "applied";

  switch (input.action.status) {
    case "executed":
      return "awaiting_application";
    case "pending_approvals":
    case "timelocked":
      return "awaiting_execution";
    case "expired":
      return "expired";
    default:
      return "unrecognized";
  }
}




