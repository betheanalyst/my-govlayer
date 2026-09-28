import type {
  AdminAction,
  GovernanceConfig,
  GovernanceEvent,
  PendingAdminAction,
  Proposal,
} from "./types";

/**
 * Test-only domain factories.
 *
 * Imported exclusively by `*.test.ts` files and never by application code, so no
 * fabricated protocol value can reach the running application (Experience
 * Blueprint section 2.11). Every field mirrors a real GovLayerCore /
 * GovLayerAdmin value.
 */

const PROPOSER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const BASE_TIME = 1_700_000_000;

export const TEST_ADDRESSES = { proposer: PROPOSER, other: OTHER } as const;

export function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposalId: 1n,
    proposer: PROPOSER,
    proposalType: "standard",
    title: "Fund a public goods round",
    description: "Body of the proposal.",
    proposedConstitution: "",
    constitutionSnapshot: "The constitution as captured at submission.",
    status: "pending",
    rawStatus: "pending",
    failureReason: "",
    aiAuditDecision: "accept",
    aiAuditReasoning: "No conflicts found.",
    conflicts: [],
    resubmissionCount: 0,
    votesYes: 0n,
    votesNo: 0n,
    createdAt: BASE_TIME,
    votingClosesAt: BASE_TIME + 3_600,
    disputeStage: 0,
    disputeHistory: [],
    ...overrides,
  };
}

export function makeConfig(
  overrides: Partial<GovernanceConfig> = {},
): GovernanceConfig {
  return {
    adminContractAddress: "0xf85b2e784c984Dc456C2827e321cC7C26320df84",
    constitutionVersion: 1n,
    eligibilityMode: "open",
    votingWeightMode: "equal",
    votingToken: "0x0000000000000000000000000000000000000000",
    customTokenInterfaceKind: "",
    minTokensToVote: 0n,
    minTokensToPropose: 0n,
    useWhitelistForVoting: false,
    useWhitelistForProposing: false,
    minQuorum: 3n,
    approvalThresholdPercent: 60n,
    minVotingDuration: 3_600,
    maxVotingDuration: 2_592_000,
    maxResubmissions: 3n,
    disputeCooldownSeconds: 3_600,
    maxDisputeStagesCount: 3n,
    maxProposalsPerWindow: 7n,
    proposalRateWindowSecs: 604_800,
    proposalCount: 1n,
    governanceHistoryCount: 1n,
    ...overrides,
  };
}

export function makeAdminAction(overrides: Partial<AdminAction> = {}): AdminAction {
  return {
    actionId: "ACTION-00000001",
    actionType: "set_voting_parameters",
    targetHex: "",
    params: '{"min_quorum":4}',
    proposer: PROPOSER,
    proposedAt: BASE_TIME,
    expiresAt: BASE_TIME + 86_400,
    thresholdReachedAt: 0,
    readyAt: 0,
    status: "pending_approvals",
    rawStatus: "pending_approvals",
    validApprovalsNow: 1,
    currentThreshold: 2,
    ...overrides,
  };
}

export function makePendingAction(
  overrides: Partial<PendingAdminAction> = {},
): PendingAdminAction {
  const action = makeAdminAction();
  return {
    actionId: action.actionId,
    actionType: action.actionType,
    targetHex: action.targetHex,
    proposer: action.proposer,
    proposedAt: action.proposedAt,
    expiresAt: action.expiresAt,
    readyAt: action.readyAt,
    status: action.status,
    rawStatus: action.rawStatus,
    validApprovalsNow: action.validApprovalsNow,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<GovernanceEvent> = {}): GovernanceEvent {
  return {
    eventType: "proposal_created",
    proposalId: 1n,
    actor: PROPOSER,
    timestamp: BASE_TIME,
    details:
      "Proposal #1 (type:standard ai:accept status:pending closes:1700003600)",
    ...overrides,
  };
}

export const TEST_TIME = { base: BASE_TIME } as const;
