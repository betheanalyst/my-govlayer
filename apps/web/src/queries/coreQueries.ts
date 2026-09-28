"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { GovLayerCoreAdapter } from "@/adapters/GovLayerCoreAdapter";
import type {
  ConstitutionVersion,
  GovernanceConfig,
  GovernanceEvent,
  Proposal,
  ProposalRevision,
} from "@/domain/types";
import { descendingWindow } from "@/lib/pagination";
import { queryKeys } from "./keys";
import { STALE_TIME } from "./policy";

/**
 * GovLayerCore read queries.
 *
 * Each query is expressed as a `queryOptions` factory so the fetching function is
 * a plain, testable async function, and hooks are a thin wrapper around it. All
 * listing reads go through the pagination helpers, which enforce the boundary
 * rule discovered on chain: the contracts reject `limit = 0`, so an empty window
 * is never sent -- it short-circuits to an empty page.
 */

/** A fresh adapter over the process-wide read-only connection. */
export function coreAdapter(): GovLayerCoreAdapter {
  return new GovLayerCoreAdapter();
}

export interface ProposalPage {
  readonly proposals: readonly Proposal[];
  /** Total proposals recorded on chain (`proposal_count`). */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** True when older proposals exist beyond this page. */
  readonly hasOlder: boolean;
}

export interface GovernanceHistoryPage {
  readonly events: readonly GovernanceEvent[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly hasOlder: boolean;
}

export interface ConstitutionPage {
  readonly versions: readonly ConstitutionVersion[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly hasOlder: boolean;
}

export function governanceConfigQuery(adapter: GovLayerCoreAdapter = coreAdapter()) {
  return queryOptions<GovernanceConfig>({
    queryKey: queryKeys.core.config(),
    queryFn: () => adapter.getConfig(),
    staleTime: STALE_TIME.config,
  });
}

export function adminContractConfiguredQuery(
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<boolean>({
    queryKey: queryKeys.core.adminContractConfigured(),
    queryFn: () => adapter.isAdminContractConfigured(),
    staleTime: STALE_TIME.config,
  });
}

export function proposalQuery(
  proposalId: bigint,
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<Proposal>({
    queryKey: queryKeys.core.proposal(proposalId.toString()),
    queryFn: () => adapter.getProposal(proposalId),
    staleTime: STALE_TIME.proposal,
  });
}

/** Newest-first page of proposals. */
export function proposalPageQuery(
  page: number,
  pageSize: number,
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<ProposalPage>({
    queryKey: queryKeys.core.proposalPage(page, pageSize),
    queryFn: async (): Promise<ProposalPage> => {
      const config = await adapter.getConfig();
      const total = Number(config.proposalCount);
      const window = descendingWindow(total, page, pageSize);

      if (window.isEmpty) {
        return { proposals: [], total, page, pageSize, hasOlder: false };
      }

      const proposals = await adapter.listProposals(window.offset, window.limit);
      return {
        proposals,
        total,
        page,
        pageSize,
        hasOlder: window.hasOlder,
      };
    },
    staleTime: STALE_TIME.proposals,
  });
}

/**
 * Revision history for one proposal. Append-only and bounded by the contract's
 * resubmission cap, so a single bounded read is sufficient.
 */
export function proposalRevisionsQuery(
  proposalId: bigint,
  limit = 50,
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<readonly ProposalRevision[]>({
    queryKey: queryKeys.core.revisions(proposalId.toString()),
    queryFn: () => adapter.getProposalRevisions(proposalId, 0, limit),
    staleTime: STALE_TIME.revisions,
  });
}
/** Newest-first page of the governance history feed. */
export function governanceHistoryPageQuery(
  page: number,
  pageSize: number,
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<GovernanceHistoryPage>({
    queryKey: queryKeys.core.historyPage(page, pageSize),
    queryFn: async (): Promise<GovernanceHistoryPage> => {
      const config = await adapter.getConfig();
      const total = Number(config.governanceHistoryCount);
      const window = descendingWindow(total, page, pageSize);

      if (window.isEmpty) {
        return { events: [], total, page, pageSize, hasOlder: false };
      }

      const events = await adapter.getGovernanceHistory(
        window.offset,
        window.limit,
      );
      return { events, total, page, pageSize, hasOlder: window.hasOlder };
    },
    staleTime: STALE_TIME.history,
  });
}

/**
 * One constitution version. `get_constitution_history` is the only view that
 * carries constitution text, and it is offset-based from version 1.
 */
export function constitutionVersionQuery(
  version: bigint,
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<ConstitutionVersion>({
    queryKey: queryKeys.core.constitutionVersion(version.toString()),
    queryFn: async () => {
      const offset = Number(version) - 1;
      if (offset < 0) {
        throw new RangeError("constitution versions start at 1");
      }
      const [found] = await adapter.getConstitutionHistory(offset, 1);
      if (found === undefined) {
        throw new RangeError(`constitution version ${version} was not returned`);
      }
      return found;
    },
    staleTime: STALE_TIME.constitution,
  });
}

/** Newest-first page of constitution versions. */
export function constitutionHistoryPageQuery(
  page: number,
  pageSize: number,
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<ConstitutionPage>({
    queryKey: queryKeys.core.constitutionPage(page, pageSize),
    queryFn: async (): Promise<ConstitutionPage> => {
      const config = await adapter.getConfig();
      const total = Number(config.constitutionVersion);
      const window = descendingWindow(total, page, pageSize);

      if (window.isEmpty) {
        return { versions: [], total, page, pageSize, hasOlder: false };
      }

      const versions = await adapter.getConstitutionHistory(
        window.offset,
        window.limit,
      );
      return { versions, total, page, pageSize, hasOlder: window.hasOlder };
    },
    staleTime: STALE_TIME.constitution,
  });
}

/**
 * Whether GovLayerCore has recorded a given authorized action as applied.
 * This is the authoritative answer to "did the change actually take effect" --
 * `executed` on GovLayerAdmin is authorization only.
 */
export function adminActionAppliedQuery(
  actionId: string,
  adapter: GovLayerCoreAdapter = coreAdapter(),
) {
  return queryOptions<boolean>({
    queryKey: queryKeys.core.actionApplied(actionId),
    queryFn: () => adapter.isAdminActionApplied(actionId),
    staleTime: STALE_TIME.actionApplied,
  });
}

// -- Hooks --------------------------------------------------------------------

export function useGovernanceConfig() {
  return useQuery(governanceConfigQuery());
}

export function useAdminContractConfigured() {
  return useQuery(adminContractConfiguredQuery());
}

export function useProposal(proposalId: bigint) {
  return useQuery(proposalQuery(proposalId));
}

export function useProposalPage(page: number, pageSize: number) {
  return useQuery(proposalPageQuery(page, pageSize));
}

export function useProposalRevisions(proposalId: bigint, limit = 50) {
  return useQuery(proposalRevisionsQuery(proposalId, limit));
}

export function useGovernanceHistoryPage(page: number, pageSize: number) {
  return useQuery(governanceHistoryPageQuery(page, pageSize));
}

export function useConstitutionVersion(version: bigint) {
  return useQuery(constitutionVersionQuery(version));
}

export function useConstitutionHistoryPage(page: number, pageSize: number) {
  return useQuery(constitutionHistoryPageQuery(page, pageSize));
}

/** Stewardship detail uses this on demand, hence the `enabled` switch. */
export function useAdminActionApplied(actionId: string, enabled = true) {
  return useQuery({ ...adminActionAppliedQuery(actionId), enabled });
}

