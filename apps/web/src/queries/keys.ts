/**
 * Query key factory.
 *
 * Keys are hierarchical so an invalidation can target one record, one
 * collection, or one contract's whole surface without guesswork. Every key is
 * derived from parameters that actually identify the request -- never from
 * component state -- so two components requesting the same record share a cache
 * entry and no stale variant is created.
 */

export const queryKeys = {
  core: {
    all: ["core"] as const,
    config: () => [...queryKeys.core.all, "config"] as const,
    adminContractConfigured: () =>
      [...queryKeys.core.all, "admin-contract-configured"] as const,
    proposals: () => [...queryKeys.core.all, "proposals"] as const,
    proposal: (proposalId: string) =>
      [...queryKeys.core.proposals(), "record", proposalId] as const,
    proposalPage: (page: number, pageSize: number) =>
      [...queryKeys.core.proposals(), "page", page, pageSize] as const,
    revisions: (proposalId: string) =>
      [...queryKeys.core.proposal(proposalId), "revisions"] as const,
    history: () => [...queryKeys.core.all, "governance-history"] as const,
    historyPage: (page: number, pageSize: number) =>
      [...queryKeys.core.history(), page, pageSize] as const,
    constitution: () => [...queryKeys.core.all, "constitution"] as const,
    constitutionVersion: (version: string) =>
      [...queryKeys.core.constitution(), "version", version] as const,
    constitutionPage: (page: number, pageSize: number) =>
      [...queryKeys.core.constitution(), "page", page, pageSize] as const,
    whitelistMembership: (kind: "voter" | "proposer", address: string) =>
      [...queryKeys.core.all, "whitelist", kind, address.toLowerCase()] as const,
    actionApplied: (actionId: string) =>
      [...queryKeys.core.all, "action-applied", actionId] as const,
    /**
     * The richer application record (applied-at time and any permanent pull
     * rejection). Kept separate from `actionApplied` so two query results never
     * share one cache entry.
     */
    actionApplication: (actionId: string) =>
      [...queryKeys.core.all, "action-application", actionId] as const,
  },
  admin: {
    all: ["admin"] as const,
    snapshot: () => [...queryKeys.admin.all, "snapshot"] as const,
    membership: (address: string) =>
      [...queryKeys.admin.all, "membership", address.toLowerCase()] as const,
    rateLimit: () => [...queryKeys.admin.all, "rate-limit"] as const,
    disputeSafety: () => [...queryKeys.admin.all, "dispute-safety"] as const,
    actions: () => [...queryKeys.admin.all, "actions"] as const,
    action: (actionId: string) =>
      [...queryKeys.admin.actions(), "record", actionId] as const,
    pendingPage: (page: number, pageSize: number) =>
      [...queryKeys.admin.actions(), "pending", page, pageSize] as const,
    /** The scanned action-id space: bounded by the scan cap it was run with. */
    scannedActions: (maxScan: number) =>
      [...queryKeys.admin.actions(), "scan", maxScan] as const,
  },
} as const;
