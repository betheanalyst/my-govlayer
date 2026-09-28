/**
 * GovLayer domain models.
 *
 * These mirror what GovLayerCore and GovLayerAdmin actually expose -- nothing
 * more. Where a contract value is a closed vocabulary (statuses, decision
 * outcomes, action types), the model keeps the raw string alongside a
 * recognized value, so a future contract vocabulary addition surfaces as
 * "unrecognized" in the UI rather than being silently mislabelled.
 *
 * Counts and tallies stay `bigint` all the way to the presentation layer
 * (Foundation Standard section 11).
 */

export const PROPOSAL_STATUSES = [
  "pending",
  "rejected",
  "needs_revision",
  "under_review",
  "passed",
  "failed",
  "pending_constitution_confirm",
  "cancelled",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_TYPES = ["standard", "constitution"] as const;

export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/** Constitutional review outcome recorded by the AI audit. */
export const AUDIT_DECISIONS = ["accept", "reject", "revise"] as const;

export type AuditDecision = (typeof AUDIT_DECISIONS)[number];

export const FAILURE_REASONS = [
  "",
  "quorum_not_met",
  "threshold_not_met",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export const ELIGIBILITY_MODES = ["open", "erc20", "nft", "custom"] as const;

export type EligibilityMode = (typeof ELIGIBILITY_MODES)[number];

export const VOTING_WEIGHT_MODES = ["equal", "token_weighted"] as const;

export type VotingWeightMode = (typeof VOTING_WEIGHT_MODES)[number];

export const ADMIN_ACTION_STATUSES = [
  "pending_approvals",
  "timelocked",
  "executed",
  "expired",
] as const;

export type AdminActionStatus = (typeof ADMIN_ACTION_STATUSES)[number];

/** Marker for a contract value this frontend does not recognise. */
export const UNRECOGNIZED = "unrecognized";

export type RecognizedOrUnrecognized<T extends string> =
  | T
  | typeof UNRECOGNIZED;

export interface ConstitutionalConflict {
  readonly description: string;
  readonly severity: string;
}

export interface DisputeRecord {
  readonly stage: number;
  readonly raisedBy: string;
  readonly raisedAt: number;
  readonly resolution: string;
  readonly reasoning: string;
}

export interface Proposal {
  readonly proposalId: bigint;
  readonly proposer: string;
  readonly proposalType: RecognizedOrUnrecognized<ProposalType>;
  readonly title: string;
  readonly description: string;
  /** Proposed constitution text; empty for standard proposals. */
  readonly proposedConstitution: string;
  /**
   * Constitution text captured at submission. Later review, revision, and
   * dispute stages all evaluate against this snapshot, never the live
   * constitution -- the UI must present it as such.
   */
  readonly constitutionSnapshot: string;
  readonly status: RecognizedOrUnrecognized<ProposalStatus>;
  /** Exact status string from the contract. */
  readonly rawStatus: string;
  readonly failureReason: string;
  readonly aiAuditDecision: RecognizedOrUnrecognized<AuditDecision> | "";
  readonly aiAuditReasoning: string;
  readonly conflicts: readonly ConstitutionalConflict[];
  readonly resubmissionCount: number;
  readonly votesYes: bigint;
  readonly votesNo: bigint;
  readonly createdAt: number;
  readonly votingClosesAt: number;
  readonly disputeStage: number;
  readonly disputeHistory: readonly DisputeRecord[];
}
export interface ProposalRevision {
  readonly resubmitNumber: bigint;
  readonly priorDescription: string;
  readonly priorAiDecision: string;
  readonly priorAiReasoning: string;
  /** JSON string as recorded by the contract; parsed by the presentation layer. */
  readonly priorConflictsJson: string;
  readonly revisedAt: number;
}

export interface ConstitutionVersion {
  readonly version: bigint;
  readonly text: string;
  readonly adoptedAt: number;
  readonly adoptedViaProposalId: bigint;
  /** Admin hex address, or the genesis sentinel. */
  readonly adoptedBy: string;
}

export interface GovernanceEvent {
  readonly eventType: string;
  readonly proposalId: bigint;
  readonly actor: string;
  readonly timestamp: number;
  readonly details: string;
}

export interface GovernanceConfig {
  readonly adminContractAddress: string;
  readonly constitutionVersion: bigint;
  readonly eligibilityMode: RecognizedOrUnrecognized<EligibilityMode>;
  readonly votingWeightMode: RecognizedOrUnrecognized<VotingWeightMode>;
  readonly votingToken: string;
  readonly customTokenInterfaceKind: string;
  readonly minTokensToVote: bigint;
  readonly minTokensToPropose: bigint;
  readonly useWhitelistForVoting: boolean;
  readonly useWhitelistForProposing: boolean;
  readonly minQuorum: bigint;
  readonly approvalThresholdPercent: bigint;
  readonly minVotingDuration: number;
  readonly maxVotingDuration: number;
  readonly maxResubmissions: bigint;
  readonly disputeCooldownSeconds: number;
  readonly maxDisputeStagesCount: bigint;
  readonly maxProposalsPerWindow: bigint;
  readonly proposalRateWindowSecs: number;
  readonly proposalCount: bigint;
  readonly governanceHistoryCount: bigint;
}

export interface AdminAction {
  readonly actionId: string;
  readonly actionType: string;
  readonly targetHex: string;
  /** Raw JSON payload as recorded by GovLayerAdmin. */
  readonly params: string;
  readonly proposer: string;
  readonly proposedAt: number;
  readonly expiresAt: number;
  readonly thresholdReachedAt: number;
  readonly readyAt: number;
  readonly status: RecognizedOrUnrecognized<AdminActionStatus>;
  readonly rawStatus: string;
  readonly validApprovalsNow: number;
  readonly currentThreshold: number;
}

/** Row shape returned by `get_pending_actions` (no params payload). */
export interface PendingAdminAction {
  readonly actionId: string;
  readonly actionType: string;
  readonly targetHex: string;
  readonly proposer: string;
  readonly proposedAt: number;
  readonly expiresAt: number;
  readonly readyAt: number;
  readonly status: RecognizedOrUnrecognized<AdminActionStatus>;
  readonly rawStatus: string;
  readonly validApprovalsNow: number;
}

export interface AdminSnapshot {
  readonly admins: readonly string[];
  readonly activeAdminCount: number;
  readonly bootstrapComplete: boolean;
  readonly currentThreshold: number;
  readonly paused: boolean;
}

export interface RateLimitParams {
  readonly maxProposalsPerWindow: bigint;
  readonly proposalRateWindowSecs: number;
}

export interface DisputeSafetyParams {
  readonly maxResubmissions: bigint;
  readonly disputeCooldownSeconds: number;
  readonly maxDisputeStagesCount: bigint;
}

