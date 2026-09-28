"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  scanAdminActionHistory,
  type ActionHistoryResult,
} from "@/adapters/actionHistory";
import { indexAppliedActions, indexPullRejections } from "@/domain/events";
import type { AppliedActionResult, PullRejectionResult } from "@/domain/events";
import { descendingWindow } from "@/lib/pagination";
import { queryKeys } from "./keys";
import { STALE_TIME } from "./policy";
import { adminAdapter } from "./adminQueries";
import { coreAdapter } from "./coreQueries";

/**
 * Scanned stewardship action history.
 *
 * This is the only way to reach executed and expired actions, because no
 * contract view enumerates them (see `actionHistory.ts`). It costs one read per
 * action, so the query is opt-in: hooks default to `enabled: false` and the
 * Stewardship surface turns it on explicitly.
 */

export const DEFAULT_SCAN_LIMIT = 100;

export function scannedAdminActionsQuery(
  maxScan: number = DEFAULT_SCAN_LIMIT,
  adapter = adminAdapter(),
) {
  return queryOptions<ActionHistoryResult>({
    queryKey: queryKeys.admin.scannedActions(maxScan),
    queryFn: () => scanAdminActionHistory(adapter, { maxScan }),
    staleTime: STALE_TIME.actionHistory,
  });
}

export function useScannedAdminActions(
  options: { enabled?: boolean; maxScan?: number } = {},
) {
  const maxScan = options.maxScan ?? DEFAULT_SCAN_LIMIT;
  return useQuery({
    ...scannedAdminActionsQuery(maxScan),
    enabled: options.enabled ?? false,
  });
}

/** How much Core history is read when resolving an application outcome. */
const APPLICATION_HISTORY_WINDOW = 40;

export interface CoreApplicationResult {
  readonly applied: boolean;
  readonly appliedAt: number | null;
  readonly application: AppliedActionResult | null;
  readonly rejection: PullRejectionResult | null;
}

/**
 * What GovLayerCore recorded for one authorized action.
 *
 * `executed` on GovLayerAdmin is authorization only, so this is the question
 * that decides whether a change actually took effect. Both answers live in Core:
 * `is_admin_action_applied` for the fact, and Core's own governance history for
 * the application time and for any permanent pull rejection.
 */
export function coreApplicationQuery(actionId: string, core = coreAdapter()) {
  return queryOptions<CoreApplicationResult>({
    queryKey: queryKeys.core.actionApplication(actionId),
    queryFn: async (): Promise<CoreApplicationResult> => {
      const applied = await core.isAdminActionApplied(actionId);

      const config = await core.getConfig();
      const window = descendingWindow(
        Number(config.governanceHistoryCount),
        0,
        APPLICATION_HISTORY_WINDOW,
      );
      const events = window.isEmpty
        ? []
        : await core.getGovernanceHistory(window.offset, window.limit);

      const application = indexAppliedActions(events).get(actionId) ?? null;
      const rejection = indexPullRejections(events).get(actionId) ?? null;

      return {
        applied,
        appliedAt: application?.timestamp ?? null,
        application,
        rejection,
      };
    },
    staleTime: STALE_TIME.actionApplied,
  });
}

export function useCoreApplication(actionId: string, enabled = true) {
  return useQuery({ ...coreApplicationQuery(actionId), enabled });
}

