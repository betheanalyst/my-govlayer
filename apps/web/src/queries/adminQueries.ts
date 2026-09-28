"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { GovLayerAdminAdapter } from "@/adapters/GovLayerAdminAdapter";
import type {
  AdminAction,
  AdminSnapshot,
  DisputeSafetyParams,
  PendingAdminAction,
  RateLimitParams,
} from "@/domain/types";
import { queryKeys } from "./keys";
import { STALE_TIME } from "./policy";

/**
 * GovLayerAdmin read queries.
 *
 * Note on enumeration: `get_pending_actions` returns only active actions and
 * exposes no total count, so this page type reports `mayHaveMore` (a full page
 * is evidence that more may follow) rather than claiming to know whether more
 * exist. Anything beyond the active set requires the id-space scan in
 * `stewardshipQueries`.
 */

export function adminAdapter(): GovLayerAdminAdapter {
  return new GovLayerAdminAdapter();
}

export interface PendingActionPage {
  readonly actions: readonly PendingAdminAction[];
  readonly page: number;
  readonly pageSize: number;
  /** True when a full page was returned: more *may* follow. Never certain. */
  readonly mayHaveMore: boolean;
}

export function adminSnapshotQuery(
  adapter: GovLayerAdminAdapter = adminAdapter(),
) {
  return queryOptions<AdminSnapshot>({
    queryKey: queryKeys.admin.snapshot(),
    queryFn: () => adapter.getSnapshot(),
    staleTime: STALE_TIME.adminSnapshot,
  });
}

export function adminMembershipQuery(
  address: string,
  adapter: GovLayerAdminAdapter = adminAdapter(),
) {
  return queryOptions<boolean>({
    queryKey: queryKeys.admin.membership(address),
    queryFn: () => adapter.isAdmin(address),
    staleTime: STALE_TIME.adminSnapshot,
  });
}

export function rateLimitParamsQuery(
  adapter: GovLayerAdminAdapter = adminAdapter(),
) {
  return queryOptions<RateLimitParams>({
    queryKey: queryKeys.admin.rateLimit(),
    queryFn: () => adapter.getRateLimitParams(),
    staleTime: STALE_TIME.config,
  });
}

export function disputeSafetyParamsQuery(
  adapter: GovLayerAdminAdapter = adminAdapter(),
) {
  return queryOptions<DisputeSafetyParams>({
    queryKey: queryKeys.admin.disputeSafety(),
    queryFn: () => adapter.getDisputeSafetyParams(),
    staleTime: STALE_TIME.config,
  });
}

/** Full record for one action, including its live approval count and threshold. */
export function adminActionQuery(
  actionId: string,
  adapter: GovLayerAdminAdapter = adminAdapter(),
) {
  return queryOptions<AdminAction>({
    queryKey: queryKeys.admin.action(actionId),
    queryFn: () => adapter.getAction(actionId),
    staleTime: STALE_TIME.adminActions,
  });
}

export function pendingAdminActionsQuery(
  page: number,
  pageSize: number,
  adapter: GovLayerAdminAdapter = adminAdapter(),
) {
  return queryOptions<PendingActionPage>({
    queryKey: queryKeys.admin.pendingPage(page, pageSize),
    queryFn: async (): Promise<PendingActionPage> => {
      // The contract returns active actions in id order and exposes no total, so
      // the offset is simply "skip this many active actions".
      const offset = page * pageSize;
      const actions = await adapter.getPendingActions(offset, pageSize);

      return {
        actions,
        page,
        pageSize,
        mayHaveMore: actions.length === pageSize,
      };
    },
    staleTime: STALE_TIME.adminActions,
  });
}

// -- Hooks --------------------------------------------------------------------

export function useAdminSnapshot() {
  return useQuery(adminSnapshotQuery());
}

export function useAdminMembership(address: string | undefined) {
  return useQuery({
    ...adminMembershipQuery(address ?? ""),
    enabled: address !== undefined,
  });
}

export function useRateLimitParams() {
  return useQuery(rateLimitParamsQuery());
}

export function useDisputeSafetyParams() {
  return useQuery(disputeSafetyParamsQuery());
}

export function useAdminAction(actionId: string) {
  return useQuery(adminActionQuery(actionId));
}

export function usePendingAdminActions(page: number, pageSize: number) {
  return useQuery(pendingAdminActionsQuery(page, pageSize));
}
