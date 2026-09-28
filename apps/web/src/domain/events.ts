import type { GovernanceEvent, RecognizedOrUnrecognized } from "./types";
import { UNRECOGNIZED } from "./types";

/**
 * Governance-history event classification.
 *
 * GovLayerCore does not emit EVM events: it appends records to
 * `governance_history` with an `event_type` and a free-text `details` string.
 * That log is the protocol's only activity feed, so the interface has to read
 * it. The `details` layout is a contract-side convention rather than a typed
 * field, so every parser here is:
 *
 *   - tolerant: it returns null on any unexpected shape instead of throwing;
 *   - non-destructive: the caller always keeps the recorded string, so an
 *     unparsed entry can still be shown verbatim.
 */

export const GOVERNANCE_EVENT_TYPES = [
  "contract_initialized",
  "proposal_created",
  "proposal_cancelled",
  "proposal_resubmitted",
  "proposal_passed",
  "proposal_failed",
  "constitution_update_pending_confirm",
  "dispute_resolved_reopened",
  "dispute_resolved_failed",
  "constitution_update_applied",
  "admin_action_applied",
  "admin_action_pull_rejected",
] as const;

export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number];

export function classifyGovernanceEventType(
  raw: string,
): RecognizedOrUnrecognized<GovernanceEventType> {
  return (GOVERNANCE_EVENT_TYPES as readonly string[]).includes(raw)
    ? (raw as GovernanceEventType)
    : UNRECOGNIZED;
}

const EVENT_LABELS: Record<GovernanceEventType, string> = {
  contract_initialized: "Contract initialized",
  proposal_created: "Proposal submitted",
  proposal_cancelled: "Proposal cancelled",
  proposal_resubmitted: "Proposal resubmitted",
  proposal_passed: "Proposal passed",
  proposal_failed: "Proposal failed",
  constitution_update_pending_confirm: "Constitution update awaiting confirmation",
  dispute_resolved_reopened: "Dispute accepted — reopened for voting",
  dispute_resolved_failed: "Dispute closed — proposal remains rejected",
  constitution_update_applied: "Constitution updated",
  admin_action_applied: "Authorized action applied to Core",
  admin_action_pull_rejected: "Authorized action rejected by Core",
};

/** Human label; an unrecognised type is shown as recorded, never renamed. */
export function governanceEventLabel(raw: string): string {
  const type = classifyGovernanceEventType(raw);
  return type === UNRECOGNIZED ? raw : EVENT_LABELS[type];
}

export interface AdminActionAppliedDetails {
  readonly actionId: string;
  readonly actionType: string;
  /** Trailing `key=value` pairs, as recorded by Core. */
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * Parses `action:<ACTION-ID>|type:<action_type>|<key>=<value>,...`
 * (the uniform layout used by every `admin_action_applied` branch).
 */
export function parseAdminActionAppliedDetails(
  details: string,
): AdminActionAppliedDetails | null {
  const segments = details.split("|");
  if (segments.length < 2) return null;

  const actionId = readPrefixed(segments[0], "action:");
  const actionType = readPrefixed(segments[1], "type:");
  if (actionId === null || actionType === null) return null;

  const fields: Record<string, string> = {};
  for (const pair of segments.slice(2).join("|").split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    fields[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }

  return { actionId, actionType, fields };
}

export interface PullRejectedDetails {
  readonly actionId: string;
  readonly actionType: string;
  readonly reason: string;
}

/**
 * Parses `action_id:<id>|action_type:<type>|reason:<text>`.
 * The reason is taken verbatim to the end of the string, since a recorded
 * reason may itself contain separators.
 */
export function parsePullRejectedDetails(
  details: string,
): PullRejectedDetails | null {
  const segments = details.split("|");
  const actionId = readPrefixed(segments[0], "action_id:");
  const actionType = readPrefixed(segments[1], "action_type:");
  if (actionId === null || actionType === null) return null;

  const marker = details.indexOf("reason:");
  return {
    actionId,
    actionType,
    reason: marker === -1 ? "" : details.slice(marker + "reason:".length).trim(),
  };
}
export interface ProposalCreatedDetails {
  readonly proposalId: bigint;
  readonly proposalType: string;
  readonly auditDecision: string;
  readonly initialStatus: string;
  readonly votingClosesAt: number | null;
}

/** Parses `Proposal #<id> (type:<t> ai:<decision> status:<s> closes:<unix>)`. */
export function parseProposalCreatedDetails(
  details: string,
): ProposalCreatedDetails | null {
  const idMatch = /Proposal #(\d+)/.exec(details);
  if (idMatch === null) return null;

  const closesMatch = /closes:(\d+)/.exec(details);

  return {
    proposalId: BigInt(idMatch[1] as string),
    proposalType: readToken(details, "type:"),
    auditDecision: readToken(details, "ai:"),
    initialStatus: readToken(details, "status:"),
    votingClosesAt: closesMatch === null ? null : Number(closesMatch[1]),
  };
}

export interface ConstitutionAppliedDetails {
  readonly version: bigint;
  readonly actionId: string;
  readonly proposalId: bigint;
}

/**
 * Parses
 * `Constitution updated to version <v> via action <ACTION-ID>, proposal #<id>`.
 */
export function parseConstitutionAppliedDetails(
  details: string,
): ConstitutionAppliedDetails | null {
  const match = /version (\d+) via action (\S+?),? proposal #(\d+)/.exec(details);
  if (match === null) return null;

  return {
    version: BigInt(match[1] as string),
    actionId: (match[2] as string).replace(/,$/, ""),
    proposalId: BigInt(match[3] as string),
  };
}

export interface AppliedActionResult extends AdminActionAppliedDetails {
  readonly timestamp: number;
}

export interface PullRejectionResult extends PullRejectedDetails {
  readonly timestamp: number;
}

/**
 * Indexes applied authorized actions across a page of history, keyed by action
 * id. This is how the Stewardship surface learns that Core actually applied an
 * authorization -- `executed` on Admin is authorization only.
 */
export function indexAppliedActions(
  events: readonly GovernanceEvent[],
): Map<string, AppliedActionResult> {
  const index = new Map<string, AppliedActionResult>();

  for (const event of events) {
    if (event.eventType !== "admin_action_applied") continue;
    const parsed = parseAdminActionAppliedDetails(event.details);
    if (parsed === null) continue;
    index.set(parsed.actionId, { ...parsed, timestamp: event.timestamp });
  }

  return index;
}

/**
 * Indexes pull rejections, keyed by action id. A rejection is permanent for
 * that action id and is never re-pullable.
 */
export function indexPullRejections(
  events: readonly GovernanceEvent[],
): Map<string, PullRejectionResult> {
  const index = new Map<string, PullRejectionResult>();

  for (const event of events) {
    if (event.eventType !== "admin_action_pull_rejected") continue;
    const parsed = parsePullRejectedDetails(event.details);
    if (parsed === null) continue;
    index.set(parsed.actionId, { ...parsed, timestamp: event.timestamp });
  }

  return index;
}

function readPrefixed(segment: string | undefined, prefix: string): string | null {
  if (segment === undefined) return null;
  const trimmed = segment.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const value = trimmed.slice(prefix.length).trim();
  return value === "" ? null : value;
}

function readToken(details: string, prefix: string): string {
  const match = new RegExp(`${prefix}([^\\s)]+)`).exec(details);
  return match === null ? "" : (match[1] as string);
}

