import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

/**
 * Invalidation rules.
 *
 * Foundation Standard section 8: after a write, the UI must invalidate what the
 * write actually affected and then render the *re-read* outcome -- never assume
 * the intended change happened. Several GovLayer writes finish by making a
 * decision (a stewardship action can expire instead of applying), so a
 * re-read is the only honest confirmation.
 *
 * Key prefixes do the work: invalidating `proposals()` reaches every proposal
 * page, every proposal record, and every revision list; invalidating
 * `constitution()` reaches both the version list and single versions.
 */

/** Governance configuration and the counters that drive paging. */
export function invalidateCoreConfiguration(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.core.config() });
}

/** Every proposal page and record. Used when a counter or ordering changed. */
export function invalidateProposalCollections(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.core.proposals() });
}

/** One proposal, plus its revision list. */
export function invalidateProposal(
  client: QueryClient,
  proposalId: bigint | string,
): Promise<void> {
  return client.invalidateQueries({
    queryKey: queryKeys.core.proposal(proposalId.toString()),
  });
}

/** Constitution text and version list. */
export function invalidateConstitution(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.core.constitution() });
}

/** The governance history feed (every lifecycle transition appends an entry). */
export function invalidateGovernanceHistory(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.core.history() });
}

export function invalidateAdminSnapshot(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.admin.snapshot() });
}

/** One action record only (cheapest refresh, for a detail view re-read). */
export function invalidateAdminAction(
  client: QueryClient,
  actionId: string,
): Promise<void> {
  return client
    .invalidateQueries({ queryKey: queryKeys.admin.action(actionId) })
    .then(() => undefined);
}

/**
 * Every stewardship collection: the active-action pages, individual action
 * records, and the scanned id space (all sit under the `admin.actions()` prefix).
 */
export function invalidateStewardshipCollections(
  client: QueryClient,
): Promise<void> {
  return client
    .invalidateQueries({ queryKey: queryKeys.admin.actions() })
    .then(() => undefined);
}

/**
 * Invalidation set for a GovLayerCore write.
 *
 * `constitutionChanged` should be true only when the write could have advanced
 * the constitution version (a confirmed constitution confirmation applied via
 * `apply_admin_action`).
 */
export function invalidateAfterCoreWrite(
  client: QueryClient,
  options: {
    readonly proposalId?: bigint | string;
    readonly actionId?: string;
    readonly constitutionChanged?: boolean;
  } = {},
): Promise<void> {
  const work: Promise<unknown>[] = [
    invalidateProposalCollections(client),
    invalidateGovernanceHistory(client),
    invalidateCoreConfiguration(client),
  ];

  if (options.proposalId !== undefined) {
    work.push(invalidateProposal(client, options.proposalId));
  }

  if (options.constitutionChanged === true) {
    work.push(invalidateConstitution(client));
  }

  if (options.actionId !== undefined) {
    work.push(
      client.invalidateQueries({
        queryKey: queryKeys.core.actionApplied(options.actionId),
      }),
      client.invalidateQueries({
        queryKey: queryKeys.core.actionApplication(options.actionId),
      }),
    );
  }

  return Promise.all(work).then(() => undefined);
}

/**
 * Invalidation set for a GovLayerAdmin write.
 *
 * `touchesCore` should be true for action types that GovLayerCore applies.
 * Those writes change nothing in Core until someone pulls them, so Core state
 * is only invalidated when the action actually reached `executed` -- and the
 * caller still re-reads to find out whether it was applied or rejected.
 */
export function invalidateAfterAdminWrite(
  client: QueryClient,
  options: {
    readonly actionId?: string;
    readonly touchesCore?: boolean;
  } = {},
): Promise<void> {
  const work: Promise<unknown>[] = [
    invalidateAdminSnapshot(client),
    invalidateStewardshipCollections(client),
  ];

  if (options.actionId !== undefined) {
    work.push(
      client.invalidateQueries({
        queryKey: queryKeys.admin.action(options.actionId),
      }),
    );
  }

  if (options.touchesCore === true && options.actionId !== undefined) {
    work.push(
      client.invalidateQueries({
        queryKey: queryKeys.core.actionApplied(options.actionId),
      }),
      client.invalidateQueries({
        queryKey: queryKeys.core.actionApplication(options.actionId),
      }),
    );
  }

  return Promise.all(work).then(() => undefined);
}
