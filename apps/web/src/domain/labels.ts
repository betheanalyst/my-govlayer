import type { AdminActionStage, ProposalStage } from "./state";
import type {
  AdminActionStatus,
  EligibilityMode,
  ProposalStatus,
  ProposalType,
  RecognizedOrUnrecognized,
  VotingWeightMode,
} from "./types";
import { UNRECOGNIZED } from "./types";

/**
 * Presentation vocabulary for protocol values.
 *
 * Every entry translates the contract's own term into plain language. Nothing
 * here invents a concept, and `rejected` and `failed` deliberately live in
 * different tone families so they can never be rendered as the same kind of
 * outcome (Experience Blueprint section 3, Non-Negotiable 2).
 *
 * Tones are a closed set so callers can pair them with a static class string and
 * an icon -- status is never conveyed by colour alone.
 */

export type Tone =
  | "info"
  | "positive"
  | "caution"
  | "review-negative"
  | "determination-negative"
  | "neutral"
  | "unknown";

const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "Voting open",
  rejected: "Rejected in review",
  needs_revision: "Needs revision",
  under_review: "Under review",
  passed: "Passed",
  failed: "Failed",
  pending_constitution_confirm: "Awaiting confirmation",
  cancelled: "Cancelled",
};

const PROPOSAL_STATUS_TONES: Record<ProposalStatus, Tone> = {
  pending: "info",
  rejected: "review-negative",
  needs_revision: "caution",
  under_review: "info",
  passed: "positive",
  failed: "determination-negative",
  pending_constitution_confirm: "caution",
  cancelled: "neutral",
};

export function proposalStatusLabel(
  status: RecognizedOrUnrecognized<ProposalStatus>,
): string {
  return status === UNRECOGNIZED
    ? "Unrecognized status"
    : PROPOSAL_STATUS_LABELS[status];
}

export function proposalStatusTone(
  status: RecognizedOrUnrecognized<ProposalStatus>,
): Tone {
  return status === UNRECOGNIZED ? "unknown" : PROPOSAL_STATUS_TONES[status];
}

const STAGE_LABELS: Record<ProposalStage, string> = {
  review_rejected: "Rejected in constitutional review",
  needs_revision: "Needs revision",
  voting_open: "Voting open",
  voting_closed_awaiting_finalization: "Awaiting determination",
  dispute_reevaluation: "Dispute reevaluation",
  awaiting_stewardship_confirmation: "Awaiting confirmation",
  passed: "Passed",
  failed: "Failed",
  cancelled: "Cancelled",
  unrecognized: "Unrecognized status",
};

const STAGE_TONES: Record<ProposalStage, Tone> = {
  review_rejected: "review-negative",
  needs_revision: "caution",
  voting_open: "info",
  voting_closed_awaiting_finalization: "caution",
  dispute_reevaluation: "info",
  awaiting_stewardship_confirmation: "caution",
  passed: "positive",
  failed: "determination-negative",
  cancelled: "neutral",
  unrecognized: "unknown",
};

export function proposalStageLabel(stage: ProposalStage): string {
  return STAGE_LABELS[stage];
}

export function proposalStageTone(stage: ProposalStage): Tone {
  return STAGE_TONES[stage];
}
const ADMIN_ACTION_STATUS_LABELS: Record<AdminActionStatus, string> = {
  pending_approvals: "Awaiting approvals",
  timelocked: "Timelocked",
  executed: "Executed (authorized)",
  expired: "Expired",
};

const ADMIN_ACTION_STATUS_TONES: Record<AdminActionStatus, Tone> = {
  pending_approvals: "caution",
  timelocked: "info",
  executed: "positive",
  expired: "neutral",
};

export function adminActionStatusLabel(
  status: RecognizedOrUnrecognized<AdminActionStatus>,
): string {
  return status === UNRECOGNIZED
    ? "Unrecognized status"
    : ADMIN_ACTION_STATUS_LABELS[status];
}

export function adminActionStatusTone(
  status: RecognizedOrUnrecognized<AdminActionStatus>,
): Tone {
  return status === UNRECOGNIZED ? "unknown" : ADMIN_ACTION_STATUS_TONES[status];
}

const ADMIN_ACTION_STAGE_LABELS: Record<AdminActionStage, string> = {
  awaiting_approvals: "Awaiting approvals",
  awaiting_timelock: "Timelocked",
  ready_to_execute: "Ready to execute",
  executed: "Executed (authorized)",
  expired: "Expired",
  unrecognized: "Unrecognized status",
};

export function adminActionStageLabel(stage: AdminActionStage): string {
  return ADMIN_ACTION_STAGE_LABELS[stage];
}

/** The twelve action types GovLayerAdmin can carry. */
const ADMIN_ACTION_TYPE_LABELS: Record<string, string> = {
  add_admin: "Add a steward",
  remove_admin: "Remove a steward",
  constitution_update_propose: "Authorize a constitution update",
  set_rate_limit_params: "Change proposal rate limits",
  set_eligibility_mode: "Change who may participate",
  set_token_rules: "Change token requirements",
  set_voting_weight_mode: "Change how votes are weighted",
  set_whitelist_enabled: "Turn a participation whitelist on or off",
  update_whitelist: "Update whitelist membership",
  set_voting_parameters: "Change voting parameters",
  propose_pause: "Pause new proposal submissions",
  propose_unpause: "Lift the submission pause",
};

/** Falls back to the recorded action type rather than inventing a name. */
export function adminActionTypeLabel(actionType: string): string {
  return ADMIN_ACTION_TYPE_LABELS[actionType] ?? actionType;
}

const ELIGIBILITY_MODE_LABELS: Record<EligibilityMode, string> = {
  open: "Open — any address may participate",
  erc20: "Token holders (ERC-20)",
  nft: "Governance NFT holders",
  custom: "Token holders (custom interface)",
};

export function eligibilityModeLabel(
  mode: RecognizedOrUnrecognized<EligibilityMode>,
): string {
  return mode === UNRECOGNIZED
    ? "Unrecognized eligibility mode"
    : ELIGIBILITY_MODE_LABELS[mode];
}

const WEIGHT_MODE_LABELS: Record<VotingWeightMode, string> = {
  equal: "Equal — one address, one vote",
  token_weighted: "Token-weighted — weight follows token balance",
};

export function votingWeightModeLabel(
  mode: RecognizedOrUnrecognized<VotingWeightMode>,
): string {
  return mode === UNRECOGNIZED
    ? "Unrecognized weight mode"
    : WEIGHT_MODE_LABELS[mode];
}

export function proposalTypeLabel(
  type: RecognizedOrUnrecognized<ProposalType>,
): string {
  if (type === UNRECOGNIZED) return "Unrecognized type";
  return type === "constitution" ? "Constitution amendment" : "Standard proposal";
}

/** Whitelist targets used by the contract's whitelist actions and toggles. */
export function whitelistTargetLabel(target: string): string {
  if (target === "voter" || target === "voting") return "Voting";
  if (target === "proposer" || target === "proposing") return "Proposing";
  return target;
}

/** Recorded totals are vote counts or voting weight, depending on configuration. */
export function voteUnitLabel(weighted: boolean): string {
  return weighted ? "voting weight" : "votes";
}

