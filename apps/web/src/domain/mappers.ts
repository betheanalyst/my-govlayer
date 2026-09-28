import { AppError } from "@/lib/errors";
import {
  ADMIN_ACTION_STATUSES,
  AUDIT_DECISIONS,
  ELIGIBILITY_MODES,
  PROPOSAL_STATUSES,
  PROPOSAL_TYPES,
  UNRECOGNIZED,
  VOTING_WEIGHT_MODES,
  type AdminAction,
  type AdminActionStatus,
  type AdminSnapshot,
  type AuditDecision,
  type ConstitutionalConflict,
  type ConstitutionVersion,
  type DisputeRecord,
  type DisputeSafetyParams,
  type EligibilityMode,
  type GovernanceConfig,
  type GovernanceEvent,
  type PendingAdminAction,
  type Proposal,
  type ProposalRevision,
  type ProposalStatus,
  type ProposalType,
  type RateLimitParams,
  type RecognizedOrUnrecognized,
  type VotingWeightMode,
} from "./types";

/**
 * Contract-value -> domain-model mappers.
 *
 * The UI never consumes raw SDK/contract shapes (Foundation Standard
 * section 8). Every read passes through these functions, which:
 *   - normalise the SDK's calldata-encoded values into exact JS types
 *     (counts stay bigint, timestamps become numbers);
 *   - fail loudly and specifically when a shape is missing a required field,
 *     rather than rendering `undefined` as if it were protocol data;
 *   - keep an unrecognised vocabulary value visible as `rawStatus` instead of
 *     silently coercing it into a known state.
 */

function mappingError(context: string, detail: string): AppError {
  return new AppError({
    kind: "verification_uncertainty",
    message: `A protocol record could not be read as expected (${context}).`,
    nextStep:
      "This is a read problem, not a protocol outcome. Retry shortly; if it persists the field layout may have changed.",
    recoverable: true,
    raw: detail,
  });
}

export function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw mappingError(context, `expected an object, received ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

/** Reads a value from either a plain object or an ES Map. */
export function readField(
  source: Record<string, unknown> | Map<unknown, unknown>,
  key: string,
): unknown {
  if (source instanceof Map) return source.get(key);
  return source[key];
}

function readStringValue(
  source: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = readField(source, key);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  if (value === null || value === undefined) return "";
  throw mappingError(context, `field "${key}" was not a string`);
}

function readRequiredString(
  source: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = readField(source, key);
  if (typeof value !== "string" || value === "") {
    throw mappingError(context, `field "${key}" was missing or empty`);
  }
  return value;
}

function readBoolValue(
  source: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = readField(source, key);
  if (typeof value === "boolean") return value;
  throw mappingError(context, `field "${key}" was not a boolean`);
}

/** Integers may arrive as number, string, or bigint; they stay exact. */
function readBigIntValue(
  source: Record<string, unknown>,
  key: string,
  context: string,
): bigint {
  const value = readField(source, key);
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw mappingError(context, `field "${key}" was not an integer`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw mappingError(context, `field "${key}" was not an integer value`);
}

/**
 * Timestamps and small bounded counts become numbers. The conversion is
 * validated against the safe-integer range so nothing is silently rounded.
 */
function readSafeNumber(
  source: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const exact = readBigIntValue(source, key, context);
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (exact > max || exact < -max) {
    throw mappingError(context, `field "${key}" exceeds the safe integer range`);
  }
  return Number(exact);
}

function readOptionalNumber(
  source: Record<string, unknown>,
  key: string,
  context: string,
  fallback = 0,
): number {
  const value = readField(source, key);
  if (value === undefined || value === null) return fallback;
  return readSafeNumber(source, key, context);
}

function readRecordArray(
  source: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown>[] {
  const value = readField(source, key);
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw mappingError(context, `field "${key}" was not a list`);
  }
  return value.map((entry, index) =>
    asRecord(entry, `${context}.${key}[${index}]`),
  );
}

function readStringList(
  source: Record<string, unknown>,
  key: string,
  context: string,
): string[] {
  const value = readField(source, key);
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw mappingError(context, `field "${key}" was not a list`);
  }
  return value.map((entry, index) => {
    if (typeof entry === "string") return entry;
    throw mappingError(context, `field "${key}[${index}]" was not a string`);
  });
}

function recognize<T extends string>(
  vocabulary: readonly T[],
  raw: string,
): RecognizedOrUnrecognized<T> {
  return (vocabulary as readonly string[]).includes(raw)
    ? (raw as T)
    : UNRECOGNIZED;
}

export function toConstitutionalConflict(
  raw: unknown,
  index = 0,
): ConstitutionalConflict {
  const context = `constitutional conflict ${index}`;
  const record = asRecord(raw, context);
  return {
    description: readStringValue(record, "description", context),
    severity: readStringValue(record, "severity", context),
  };
}

export function toDisputeRecord(raw: unknown, index = 0): DisputeRecord {
  const context = `dispute record ${index}`;
  const record = asRecord(raw, context);
  return {
    stage: readSafeNumber(record, "stage", context),
    raisedBy: readStringValue(record, "raised_by", context),
    raisedAt: readSafeNumber(record, "raised_at", context),
    resolution: readStringValue(record, "resolution", context),
    reasoning: readStringValue(record, "reasoning", context),
  };
}

export function toProposal(raw: unknown, index = 0): Proposal {
  const context = `proposal ${index}`;
  const record = asRecord(raw, context);

  if (Object.keys(record).length === 0) {
    throw mappingError(context, "the contract returned an empty proposal record");
  }

  const rawStatus = readStringValue(record, "status", context);
  const rawType = readStringValue(record, "proposal_type", context);
  const rawDecision = readStringValue(record, "ai_audit_decision", context);

  return {
    proposalId: readBigIntValue(record, "proposal_id", context),
    proposer: readStringValue(record, "proposer", context),
    proposalType: recognize<ProposalType>(PROPOSAL_TYPES, rawType),
    title: readStringValue(record, "title", context),
    description: readStringValue(record, "description", context),
    proposedConstitution: readStringValue(
      record,
      "proposed_constitution",
      context,
    ),
    constitutionSnapshot: readStringValue(
      record,
      "constitution_snapshot",
      context,
    ),
    status: recognize<ProposalStatus>(PROPOSAL_STATUSES, rawStatus),
    rawStatus,
    failureReason: readStringValue(record, "failure_reason", context),
    aiAuditDecision:
      rawDecision === ""
        ? ""
        : recognize<AuditDecision>(AUDIT_DECISIONS, rawDecision),
    aiAuditReasoning: readStringValue(record, "ai_audit_reasoning", context),
    conflicts: readRecordArray(record, "constitutional_conflicts", context).map(
      toConstitutionalConflict,
    ),
    resubmissionCount: readSafeNumber(record, "resubmission_count", context),
    votesYes: readBigIntValue(record, "votes_yes", context),
    votesNo: readBigIntValue(record, "votes_no", context),
    createdAt: readSafeNumber(record, "created_at", context),
    votingClosesAt: readSafeNumber(record, "voting_closes_at", context),
    disputeStage: readOptionalNumber(record, "dispute_stage", context),
    disputeHistory: readRecordArray(record, "dispute_history", context).map(
      toDisputeRecord,
    ),
  };
}

export function toProposalRevision(raw: unknown, index = 0): ProposalRevision {
  const context = `proposal revision ${index}`;
  const record = asRecord(raw, context);
  return {
    resubmitNumber: readBigIntValue(record, "resubmit_number", context),
    priorDescription: readStringValue(record, "prior_description", context),
    priorAiDecision: readStringValue(record, "prior_ai_decision", context),
    priorAiReasoning: readStringValue(record, "prior_ai_reasoning", context),
    priorConflictsJson: readStringValue(record, "prior_conflicts_json", context),
    revisedAt: readSafeNumber(record, "revised_at", context),
  };
}

export function toConstitutionVersion(
  raw: unknown,
  index = 0,
): ConstitutionVersion {
  const context = `constitution version ${index}`;
  const record = asRecord(raw, context);
  return {
    version: readBigIntValue(record, "version", context),
    text: readStringValue(record, "text", context),
    adoptedAt: readSafeNumber(record, "adopted_at", context),
    adoptedViaProposalId: readBigIntValue(
      record,
      "adopted_via_proposal_id",
      context,
    ),
    adoptedBy: readStringValue(record, "adopted_by", context),
  };
}

export function toGovernanceEvent(raw: unknown, index = 0): GovernanceEvent {
  const context = `governance history entry ${index}`;
  const record = asRecord(raw, context);
  return {
    eventType: readStringValue(record, "event_type", context),
    proposalId: readBigIntValue(record, "proposal_id", context),
    actor: readStringValue(record, "actor", context),
    timestamp: readSafeNumber(record, "timestamp", context),
    details: readStringValue(record, "details", context),
  };
}
export function toGovernanceConfig(raw: unknown): GovernanceConfig {
  const context = "governance configuration";
  const record = asRecord(raw, context);

  const rawEligibility = readStringValue(record, "eligibility_mode", context);
  const rawWeightMode = readStringValue(record, "voting_weight_mode", context);

  return {
    adminContractAddress: readStringValue(
      record,
      "admin_contract_address",
      context,
    ),
    constitutionVersion: readBigIntValue(record, "constitution_version", context),
    eligibilityMode: recognize<EligibilityMode>(
      ELIGIBILITY_MODES,
      rawEligibility,
    ),
    votingWeightMode: recognize<VotingWeightMode>(
      VOTING_WEIGHT_MODES,
      rawWeightMode,
    ),
    votingToken: readStringValue(record, "voting_token", context),
    customTokenInterfaceKind: readStringValue(
      record,
      "custom_token_interface_kind",
      context,
    ),
    minTokensToVote: readBigIntValue(record, "min_tokens_to_vote", context),
    minTokensToPropose: readBigIntValue(
      record,
      "min_tokens_to_propose",
      context,
    ),
    useWhitelistForVoting: readBoolValue(
      record,
      "use_whitelist_for_voting",
      context,
    ),
    useWhitelistForProposing: readBoolValue(
      record,
      "use_whitelist_for_proposing",
      context,
    ),
    minQuorum: readBigIntValue(record, "min_quorum", context),
    approvalThresholdPercent: readBigIntValue(
      record,
      "approval_threshold_percent",
      context,
    ),
    minVotingDuration: readSafeNumber(record, "min_voting_duration", context),
    maxVotingDuration: readSafeNumber(record, "max_voting_duration", context),
    maxResubmissions: readBigIntValue(record, "max_resubmissions", context),
    disputeCooldownSeconds: readSafeNumber(
      record,
      "dispute_cooldown_seconds",
      context,
    ),
    maxDisputeStagesCount: readBigIntValue(
      record,
      "max_dispute_stages_count",
      context,
    ),
    maxProposalsPerWindow: readBigIntValue(
      record,
      "max_proposals_per_window",
      context,
    ),
    proposalRateWindowSecs: readSafeNumber(
      record,
      "proposal_rate_window_secs",
      context,
    ),
    proposalCount: readBigIntValue(record, "proposal_count", context),
    governanceHistoryCount: readBigIntValue(
      record,
      "governance_history_count",
      context,
    ),
  };
}

export function toAdminAction(raw: unknown): AdminAction {
  const context = "admin action";
  const record = asRecord(raw, context);
  const rawStatus = readStringValue(record, "status", context);

  return {
    actionId: readRequiredString(record, "action_id", context),
    actionType: readStringValue(record, "action_type", context),
    targetHex: readStringValue(record, "target_hex", context),
    params: readStringValue(record, "params", context),
    proposer: readStringValue(record, "proposer", context),
    proposedAt: readSafeNumber(record, "proposed_at", context),
    expiresAt: readSafeNumber(record, "expires_at", context),
    thresholdReachedAt: readOptionalNumber(
      record,
      "threshold_reached_at",
      context,
    ),
    readyAt: readOptionalNumber(record, "ready_at", context),
    status: recognize<AdminActionStatus>(ADMIN_ACTION_STATUSES, rawStatus),
    rawStatus,
    validApprovalsNow: readOptionalNumber(record, "valid_approvals_now", context),
    currentThreshold: readOptionalNumber(record, "current_threshold", context),
  };
}
export function toPendingAdminAction(
  raw: unknown,
  index = 0,
): PendingAdminAction {
  const context = `pending admin action ${index}`;
  const record = asRecord(raw, context);
  const rawStatus = readStringValue(record, "status", context);

  return {
    actionId: readRequiredString(record, "action_id", context),
    actionType: readStringValue(record, "action_type", context),
    targetHex: readStringValue(record, "target_hex", context),
    proposer: readStringValue(record, "proposer", context),
    proposedAt: readSafeNumber(record, "proposed_at", context),
    expiresAt: readSafeNumber(record, "expires_at", context),
    readyAt: readOptionalNumber(record, "ready_at", context),
    status: recognize<AdminActionStatus>(ADMIN_ACTION_STATUSES, rawStatus),
    rawStatus,
    validApprovalsNow: readOptionalNumber(
      record,
      "valid_approvals_now",
      context,
    ),
  };
}

/** Composes the five separate GovLayerAdmin reads into one snapshot. */
export function toAdminSnapshot(parts: {
  admins: unknown;
  activeAdminCount: unknown;
  bootstrapComplete: unknown;
  currentThreshold: unknown;
  paused: unknown;
}): AdminSnapshot {
  const context = "admin snapshot";
  const shape = asRecord(
    {
      admins: parts.admins,
      active_admin_count: parts.activeAdminCount,
      bootstrap_complete: parts.bootstrapComplete,
      current_threshold: parts.currentThreshold,
      paused: parts.paused,
    },
    context,
  );

  return {
    admins: readStringList(shape, "admins", context),
    activeAdminCount: readSafeNumber(shape, "active_admin_count", context),
    bootstrapComplete: readBoolValue(shape, "bootstrap_complete", context),
    currentThreshold: readSafeNumber(shape, "current_threshold", context),
    paused: readBoolValue(shape, "paused", context),
  };
}

export function toRateLimitParams(raw: unknown): RateLimitParams {
  const context = "rate limit parameters";
  const record = asRecord(raw, context);
  return {
    maxProposalsPerWindow: readBigIntValue(
      record,
      "max_proposals_per_window",
      context,
    ),
    proposalRateWindowSecs: readSafeNumber(
      record,
      "proposal_rate_window_secs",
      context,
    ),
  };
}

export function toDisputeSafetyParams(raw: unknown): DisputeSafetyParams {
  const context = "dispute safety parameters";
  const record = asRecord(raw, context);
  return {
    maxResubmissions: readBigIntValue(record, "max_resubmissions", context),
    disputeCooldownSeconds: readSafeNumber(
      record,
      "dispute_cooldown_seconds",
      context,
    ),
    maxDisputeStagesCount: readBigIntValue(
      record,
      "max_dispute_stages_count",
      context,
    ),
  };
}

/** Maps a listing response, tolerating an empty or absent return value. */
export function toList<T>(
  raw: unknown,
  mapper: (entry: unknown, index: number) => T,
  context: string,
): T[] {
  if (raw === null || raw === undefined || raw === "0x") return [];
  if (!Array.isArray(raw)) {
    throw mappingError(context, `expected a list, received ${typeof raw}`);
  }
  return raw.map((entry, index) => mapper(entry, index));
}



