import type { AdminAction } from "@/domain/types";
import { classifyError } from "@/lib/errors";
import type { GovLayerAdminAdapter } from "./GovLayerAdminAdapter";

/**
 * Stewardship action enumeration.
 *
 * GovLayerAdmin exposes no "all actions" view and no action counter:
 *   - `get_pending_actions` returns only actions still in `pending_approvals` or
 *     `timelocked`;
 *   - `get_action(action_id)` works for any action ever created.
 *
 * Action ids are allocated from a counter that starts at zero and only ever
 * increments, so the first action is `ACTION-00000000`. The full history is
 * therefore reachable by walking the id space upwards, and the *first* id whose
 * lookup is rejected marks the end of the allocated range.
 *
 * Two verified behaviours shape this walk:
 *   1. A lookup for an id beyond the range is rejected by the network as an
 *      unreadable execution failure, not as the contract's own "not found"
 *      message. That is not evidence about the actions already returned, so the
 *      scan stops and *says that it stopped* rather than throwing away results or
 *      pretending the range ended cleanly.
 *   2. A rejection could also mean a transient read problem. Either way the
 *      honest outcome is "unconfirmed beyond this id", which is what the caller
 *      receives.
 *
 * The walk is bounded (`maxScan`) and memoised per admin address, so repeated
 * scans do not re-probe ids already known to exist.
 */

export const ACTION_ID_PREFIX = "ACTION-";
export const ACTION_ID_DIGITS = 8;

/** The contract allocates action ids from zero. */
export const FIRST_ACTION_COUNTER = 0;

/** Formats a counter into the contract's `ACTION-%08d` id format. */
export function formatActionId(counter: number): string {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new RangeError("action counter must be a non-negative integer");
  }
  return `${ACTION_ID_PREFIX}${counter.toString(10).padStart(ACTION_ID_DIGITS, "0")}`;
}

/** Parses an action id back to its counter, or null when it is not well formed. */
export function parseActionId(actionId: string): number | null {
  if (!actionId.startsWith(ACTION_ID_PREFIX)) return null;
  const digits = actionId.slice(ACTION_ID_PREFIX.length);
  if (!/^\d+$/.test(digits)) return null;
  const counter = Number.parseInt(digits, 10);
  return Number.isSafeInteger(counter) ? counter : null;
}

const highestKnown = new Map<string, number>();

/**
 * Highest counter confirmed to exist for an address, or -1 when nothing is
 * known yet (so the first probe is counter 0).
 */
export function cachedHighWaterMark(adminAddress: string): number {
  return highestKnown.get(adminAddress.trim().toLowerCase()) ?? -1;
}

/** Clears memoised scan positions (tests and explicit refreshes). */
export function resetActionHistoryCache(): void {
  highestKnown.clear();
}

export interface ActionHistoryOptions {
  /** First counter to probe. Defaults to "just past what is already known". */
  readonly startFrom?: number;
  /** Hard cap on counters probed in one pass. */
  readonly maxScan?: number;
  /** Set false to ignore the memo and probe from counter 0. */
  readonly useCache?: boolean;
}

export interface ActionHistoryResult {
  readonly actions: readonly AdminAction[];
  /** Highest counter confirmed to exist; -1 when the contract has none. */
  readonly highWaterMark: number;
  /** True only when the walk reached a confirmed end of the allocated range. */
  readonly complete: boolean;
  /** Counter at which an unreadable rejection stopped the walk, if it did. */
  readonly stoppedAt: number | null;
  /** Recorded reason the walk stopped early, if it did. */
  readonly stopReason: string | null;
  /** Number of contract reads performed, for cost visibility. */
  readonly reads: number;
}

/**
 * Walks the action-id space and returns every action found.
 * Executed and expired actions are included: the contract retains them.
 */
export async function scanAdminActionHistory(
  adapter: GovLayerAdminAdapter,
  options: ActionHistoryOptions = {},
): Promise<ActionHistoryResult> {
  const maxScan = options.maxScan ?? 200;
  const memoised = cachedHighWaterMark(adapter.address);
  const firstProbe =
    options.useCache === false
      ? (options.startFrom ?? FIRST_ACTION_COUNTER)
      : (options.startFrom ?? memoised + 1);

  const actions: AdminAction[] = [];
  let highWaterMark = firstProbe - 1;
  let reads = 0;
  let complete = false;
  let stoppedAt: number | null = null;
  let stopReason: string | null = null;

  for (let counter = firstProbe; counter < firstProbe + maxScan; counter += 1) {
    reads += 1;

    try {
      const action = await adapter.getAction(formatActionId(counter));
      actions.push(action);
      highWaterMark = counter;
    } catch (error) {
      const classified = classifyError(error);
      if (classified.kind === "not_found") {
        // The contract itself answered: this id was never allocated.
        complete = true;
      } else {
        stoppedAt = counter;
        stopReason = classified.raw ?? classified.message;
      }
      break;
    }
  }

  highestKnown.set(adapter.address.trim().toLowerCase(), highWaterMark);

  return {
    actions,
    highWaterMark,
    complete,
    stoppedAt,
    stopReason,
    reads,
  };
}
