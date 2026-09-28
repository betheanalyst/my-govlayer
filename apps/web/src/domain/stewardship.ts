import type { PendingAdminAction } from "./types";

/**
 * Stewardship domain model (Experience Blueprint sections 10.16 - 10.19).
 *
 * The governing fact of this area is the trust boundary: GovLayerAdmin
 * authorizes, GovLayerCore applies. Verified against the contracts:
 *
 *   - `execute_admin_action` applies FIVE action types directly to Admin's own
 *     storage: add_admin, remove_admin, set_rate_limit_params, propose_pause,
 *     propose_unpause;
 *   - for the other SEVEN it does nothing beyond the status flip to `executed`,
 *     because reaching that status *is* the authorization: Core pulls each
 *     record and applies it to its own state. Core logs an
 *     `admin_action_applied` entry when it does.
 *
 * Nothing here decides whether a change took effect. That is answered by
 * Core's `is_admin_action_applied` plus its governance history.
 */

/** Action types whose effect Admin applies itself at execution. */
export const ADMIN_APPLIED_ACTION_TYPES = [
  "add_admin",
  "remove_admin",
  "set_rate_limit_params",
  "propose_pause",
  "propose_unpause",
] as const;

/** Action types Admin authorizes and Core applies on pull. */
export const CORE_APPLIED_ACTION_TYPES = [
  "constitution_update_propose",
  "set_eligibility_mode",
  "set_token_rules",
  "set_voting_weight_mode",
  "set_whitelist_enabled",
  "update_whitelist",
  "set_voting_parameters",
] as const;

/** Approval-window state for an action still gathering approvals. */
export type ApprovalWindowState =
  | { readonly state: "not_applicable" }
  | { readonly state: "open"; readonly closesAt: number }
  /** Window elapsed: the contract will formalize this as expired when touched. */
  | { readonly state: "elapsed"; readonly closedAt: number };

/**
 * Whether an action still awaiting approvals has run out of approval window.
 *
 * Both `approve_admin_action` and `execute_admin_action` formalize an
 * out-of-window action as `expired` without reverting, so an action can sit here
 * looking pending until someone touches it. Saying so is more useful than
 * showing a countdown that has already passed.
 */
export function approvalWindowState(
  action: Pick<PendingAdminAction, "status" | "expiresAt">,
  now: number,
): ApprovalWindowState {
  if (action.status !== "pending_approvals") return { state: "not_applicable" };
  return now <= action.expiresAt
    ? { state: "open", closesAt: action.expiresAt }
    : { state: "elapsed", closedAt: action.expiresAt };
}

/** Which priority bucket an action belongs to, or null when it is finished. */
export function stewardshipPriority(
  action: Pick<PendingAdminAction, "status" | "readyAt">,
  now: number,
): StewardshipPriority | null {
  switch (action.status) {
    case "pending_approvals":
      return "requires_approval";
    case "timelocked":
      return now >= action.readyAt ? "ready_to_execute" : "timelocked";
    case "executed":
      return "recently_applied";
    case "expired":
      return "recently_expired";
    default:
      return null;
  }
}

export interface StewardshipBuckets<T> {
  readonly requires_approval: readonly T[];
  readonly timelocked: readonly T[];
  readonly ready_to_execute: readonly T[];
  readonly recently_applied: readonly T[];
  readonly recently_expired: readonly T[];
}

/**
 * Groups actions into the five overview priorities.
 *
 * Newest first within each group, using the action id: ids are allocated in
 * sequence, so a higher id is a later proposal. That is a statement about when
 * each action was *proposed* — the only ordering either contract records — and
 * the surfaces built on this say exactly that rather than implying it is an
 * event timeline.
 */
export function bucketStewardshipActions<
  T extends Pick<PendingAdminAction, "actionId" | "status" | "readyAt">,
>(actions: readonly T[], options: { readonly now: number }): StewardshipBuckets<T> {
  const buckets: Record<StewardshipPriority, T[]> = {
    requires_approval: [],
    timelocked: [],
    ready_to_execute: [],
    recently_applied: [],
    recently_expired: [],
  };

  for (const action of actions) {
    const priority = stewardshipPriority(action, options.now);
    if (priority !== null) buckets[priority].push(action);
  }

  for (const key of STEWARDSHIP_PRIORITY_ORDER) {
    buckets[key].sort((left, right) =>
      compareActionIdsDescending(left.actionId, right.actionId),
    );
  }

  return buckets;
}

/** Orders action ids newest-proposed first. Unparseable ids sort last. */
export function compareActionIdsDescending(left: string, right: string): number {
  const leftCounter = numericActionId(left);
  const rightCounter = numericActionId(right);
  if (leftCounter === null && rightCounter === null) return left.localeCompare(right);
  if (leftCounter === null) return 1;
  if (rightCounter === null) return -1;
  return rightCounter - leftCounter;
}

function numericActionId(actionId: string): number | null {
  const match = /^ACTION-(\d+)$/.exec(actionId);
  if (match === null) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Whether Admin applies this type itself, or only authorizes it for Core. */
export function actionApplier(actionType: string): "admin" | "core" | "unrecognized" {
  if ((ADMIN_APPLIED_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return "admin";
  }
  if ((CORE_APPLIED_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return "core";
  }
  return "unrecognized";
}

/**
 * What the authorized change does, in one sentence, for the action detail and
 * list surfaces. Deliberately describes the intent of the action, not its
 * outcome: whether it was applied is a separate, answerable question.
 */
export function describeActionEffect(actionType: string): string {
  switch (actionType) {
    case "add_admin":
      return "Adds an address to protocol stewardship.";
    case "remove_admin":
      return "Removes an address from protocol stewardship.";
    case "constitution_update_propose":
      return "Authorizes applying a passed constitution amendment, advancing the constitution to a new version.";
    case "set_rate_limit_params":
      return "Changes how many proposals an address may submit, and over what window.";
    case "set_eligibility_mode":
      return "Changes who may participate, and therefore what the contract checks before accepting a vote or a submission.";
    case "set_token_rules":
      return "Changes the token used for eligibility and voting weight, and the minimum holdings required.";
    case "set_voting_weight_mode":
      return "Changes whether every address counts equally or by token balance.";
    case "set_whitelist_enabled":
      return "Turns whitelist gating on or off for voting or for proposing.";
    case "update_whitelist":
      return "Adds and removes whitelist entries in one batch.";
    case "set_voting_parameters":
      return "Changes quorum, the approval threshold, and the voting-duration bounds new proposals must fall within.";
    case "propose_pause":
      return "Pauses new proposal submissions. Voting, disputing, finalizing, resubmitting, and cancelling are unaffected.";
    case "propose_unpause":
      return "Lifts the submission pause.";
    default:
      return "This interface does not recognise this action type, so it does not describe its effect.";
  }
}

/**
 * The overview priorities (Blueprint section 10.16), in the order given there.
 *
 * The first three come straight from `get_pending_actions` plus the timelock
 * clock. The last two are narrower than they sound, for the reasons recorded on
 * `STEWARDSHIP_PRIORITY_DESCRIPTIONS`.
 */
export type StewardshipPriority =
  | "requires_approval"
  | "timelocked"
  | "ready_to_execute"
  | "recently_applied"
  | "recently_expired";

export const STEWARDSHIP_PRIORITY_ORDER: readonly StewardshipPriority[] = [
  "requires_approval",
  "timelocked",
  "ready_to_execute",
  "recently_applied",
  "recently_expired",
];

export const STEWARDSHIP_PRIORITY_LABELS: Record<StewardshipPriority, string> = {
  requires_approval: "Requires approval",
  timelocked: "Timelocked",
  ready_to_execute: "Ready to execute",
  recently_applied: "Recently applied",
  recently_expired: "Recently expired",
};

export const STEWARDSHIP_PRIORITY_DESCRIPTIONS: Record<
  StewardshipPriority,
  string
> = {
  requires_approval:
    "Proposed, and still gathering approvals. Each steward approves once, and the proposer's own approval is recorded at creation.",
  timelocked:
    "Approved. A fixed timelock must elapse before execution, so an approved change is never instantaneous.",
  ready_to_execute:
    "The timelock has elapsed. Execution is permissionless, and it re-validates the action against current state before applying anything.",
  recently_applied:
    "Recorded by GovLayerCore as applied. Only Core-applied action types carry an application time, so those are what can be listed here.",
  recently_expired:
    "Formalized as expired rather than executed. Neither contract records an expiry time, so these are ordered by when the action was proposed.",
};
