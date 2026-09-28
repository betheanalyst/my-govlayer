import { GovLayerAdminAdapter } from "@/adapters/GovLayerAdminAdapter";
import { GovLayerCoreAdapter } from "@/adapters/GovLayerCoreAdapter";
import { formatActionId, parseActionId } from "@/adapters/actionHistory";
import { indexPullRejections, type PullRejectionResult } from "@/domain/events";
import type {
  AdminAction,
  AdminSnapshot,
  ConstitutionVersion,
  GovernanceConfig,
  GovernanceEvent,
  Proposal,
  ProposalRevision,
} from "@/domain/types";
import { AppError, isAppError, toAppError } from "@/lib/errors";
import { descendingWindow } from "@/lib/pagination";
import { nowUnixSeconds } from "@/lib/time";

/**
 * Server-side protocol reads.
 *
 * Server components read through this module; the browser-side query layer in
 * `queries/` calls the same adapters for interactive refetching. Both paths use
 * the same adapters, mappers, and pagination helpers, so there is exactly one
 * interpretation of contract data.
 *
 * Every listing read is bounded, and an empty window is never sent to the
 * contract (both contracts reject `limit = 0`), which is why these helpers
 * short-circuit instead of issuing a pointless reverting call.
 */

/** Per-request cap, well inside what a single contract view tolerates. */
const MAX_READ_LIMIT = 50;

/** How much of the flat governance history the record surfaces scan. */
export const HISTORY_SCAN_LIMIT = 100;

/** How much of the proposal collection the public Explore surface reviews. */
export const EXPLORE_SCAN_LIMIT = 100;

export interface RequestTime {
  /** Contract-clock seconds at the moment of render. */
  readonly now: number;
}

/**
 * Reads a bounded, newest-first slice out of any offset-paginated view.
 *
 * Each contract view returns ascending records, and `descendingWindow` walks
 * backwards from the end of the collection, so pages are collected newest-page
 * first with each page reversed -- the result is newest-first throughout.
 */
async function readNewest<T>(
  total: number,
  wanted: number,
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
): Promise<T[]> {
  const budget = Math.min(total, wanted);
  if (budget <= 0) return [];

  const collected: T[] = [];
  let page = 0;

  while (collected.length < budget) {
    const window = descendingWindow(total, page, MAX_READ_LIMIT);
    if (window.isEmpty) break;

    const chunk = await fetchPage(window.offset, window.limit);
    collected.push(...[...chunk].reverse());
    page += 1;

    if (chunk.length < window.limit) break;
  }

  return collected.slice(0, budget);
}

export async function loadGovernanceConfig(
  core = new GovLayerCoreAdapter(),
): Promise<GovernanceConfig> {
  return core.getConfig();
}

export interface ProposalRecord {
  readonly proposal: Proposal;
  readonly config: GovernanceConfig;
  readonly revisions: readonly ProposalRevision[];
  /** History entries recorded for this proposal, newest first. */
  readonly events: readonly GovernanceEvent[];
  /** Total history entries on chain, so the surface can state its scan scope. */
  readonly historyTotal: number;
  readonly now: number;
}

export async function loadProposalRecord(
  proposalId: bigint,
  core = new GovLayerCoreAdapter(),
): Promise<ProposalRecord> {
  const [config, proposal] = await Promise.all([
    core.getConfig(),
    core.getProposal(proposalId),
  ]);

  const historyTotal = Number(config.governanceHistoryCount);
  const recent = await readNewest<GovernanceEvent>(
    historyTotal,
    HISTORY_SCAN_LIMIT,
    (offset, limit) => core.getGovernanceHistory(offset, limit),
  );

  const revisions =
    proposal.resubmissionCount > 0
      ? await core.getProposalRevisions(proposalId, 0, MAX_READ_LIMIT)
      : [];

  return {
    proposal,
    config,
    revisions,
    events: recent.filter((event) => event.proposalId === proposalId),
    historyTotal,
    now: nowUnixSeconds(),
  };
}

export interface ExploreSet {
  readonly proposals: readonly Proposal[];
  readonly config: GovernanceConfig;
  /** Total proposals recorded on chain. */
  readonly total: number;
  /** How many of them this surface actually reviewed. */
  readonly scanned: number;
  readonly paused: boolean;
  readonly now: number;
}

export async function loadExploreSet(
  core = new GovLayerCoreAdapter(),
  admin = new GovLayerAdminAdapter(),
): Promise<ExploreSet> {
  const config = await core.getConfig();
  const total = Number(config.proposalCount);

  const [proposals, snapshot] = await Promise.all([
    readNewest<Proposal>(total, EXPLORE_SCAN_LIMIT, (offset, limit) =>
      core.listProposals(offset, limit),
    ),
    admin.getSnapshot().catch(() => undefined),
  ]);

  return {
    proposals,
    config,
    total,
    scanned: proposals.length,
    paused: snapshot?.paused ?? false,
    now: nowUnixSeconds(),
  };
}

export interface ConstitutionHistoryPage {
  readonly versions: readonly ConstitutionVersion[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly hasOlder: boolean;
  readonly currentVersion: bigint;
  readonly config: GovernanceConfig;
  readonly now: number;
}

export async function loadConstitutionHistoryPage(
  page: number,
  pageSize: number,
  core = new GovLayerCoreAdapter(),
): Promise<ConstitutionHistoryPage> {
  const config = await core.getConfig();
  const total = Number(config.constitutionVersion);
  const window = descendingWindow(total, page, pageSize);

  const versions = window.isEmpty
    ? []
    : await core.getConstitutionHistory(window.offset, window.limit);

  return {
    versions,
    total,
    page,
    pageSize,
    hasOlder: window.hasOlder,
    currentVersion: config.constitutionVersion,
    config,
    now: nowUnixSeconds(),
  };
}

export interface ConstitutionRecord {
  readonly version: ConstitutionVersion;
  readonly config: GovernanceConfig;
  /** Proposal that produced this version, when one is recorded. */
  readonly proposalId: bigint | null;
  readonly now: number;
}

/** Reads one constitution version. `get_constitution_history` is offset-based. */
export async function loadConstitutionVersion(
  version: bigint,
  core = new GovLayerCoreAdapter(),
): Promise<ConstitutionRecord> {
  const offset = Number(version) - 1;
  if (offset < 0) {
    throw new AppError({
      kind: "not_found",
      message: "Constitution versions are numbered from 1.",
    });
  }

  const [config, batch] = await Promise.all([
    core.getConfig(),
    core.getConstitutionHistory(offset, 1),
  ]);

  const found = batch[0];
  if (found === undefined) {
    throw new AppError({
      kind: "not_found",
      message: `Constitution version ${version} does not exist on chain.`,
    });
  }

  return {
    version: found,
    config,
    proposalId: found.adoptedViaProposalId > 0n ? found.adoptedViaProposalId : null,
    now: nowUnixSeconds(),
  };
}

export interface StewardshipSummary {
  readonly snapshot: AdminSnapshot;
  readonly config: GovernanceConfig;
}

/**
 * Public stewardship facts only: how many stewards exist, the current approval
 * threshold, and whether new submissions are paused. No action internals.
 */
export async function loadStewardshipSummary(
  core = new GovLayerCoreAdapter(),
  admin = new GovLayerAdminAdapter(),
): Promise<StewardshipSummary> {
  const [config, snapshot] = await Promise.all([
    core.getConfig(),
    admin.getSnapshot(),
  ]);

  return { snapshot, config };
}

// -- Verification ------------------------------------------------------------

export type VerificationTarget =
  | { readonly kind: "invalid"; readonly identifier: string }
  | {
      /**
       * The lookup itself could not be completed: the contract rejected it in a
       * way that carries no readable answer, so this surface cannot say whether
       * the record exists.
       */
      readonly kind: "lookup_failed";
      readonly identifier: string;
      readonly error: AppError;
    }
  | {
      readonly kind: "proposal";
      readonly proposalId: bigint;
      readonly record: ProposalRecord;
    }
  | {
      readonly kind: "action";
      readonly actionId: string;
      readonly action: AdminAction;
      /** Core's own answer to "was this authorization actually applied". */
      readonly appliedToCore: boolean;
      /** Present only when Core recorded a pull rejection for this action. */
      readonly pullRejection: PullRejectionResult | null;
      readonly now: number;
    };

/**
 * Resolves the identifier a visitor typed on the Verify surface.
 *
 * Accepted forms, both drawn from the protocol's own vocabulary:
 *   - a proposal number: "3", "#3", "proposal-3", "proposal 3"
 *   - an authorized action id: "ACTION-00000003", "action-3"
 */
export function parseVerificationIdentifier(identifier: string): {
  readonly kind: "proposal" | "action";
  readonly value: bigint | string;
} | null {
  const trimmed = identifier.trim();
  if (trimmed === "") return null;

  const actionMatch = /^action[-_\s#]*0*(\d+)$/i.exec(trimmed);
  if (actionMatch !== null) {
    return { kind: "action", value: formatActionId(Number(actionMatch[1])) };
  }

  if (/^ACTION-/i.test(trimmed)) {
    const counter = parseActionId(trimmed.toUpperCase());
    return counter === null ? null : { kind: "action", value: formatActionId(counter) };
  }

  const proposalMatch = /^(?:proposal[-_\s#]*)?0*(\d+)$/i.exec(trimmed);
  if (proposalMatch !== null) {
    return { kind: "proposal", value: BigInt(proposalMatch[1] as string) };
  }

  return null;
}

export async function loadVerificationTarget(
  identifier: string,
  core = new GovLayerCoreAdapter(),
  admin = new GovLayerAdminAdapter(),
): Promise<VerificationTarget> {
  const parsed = parseVerificationIdentifier(identifier);
  if (parsed === null) {
    return { kind: "invalid", identifier };
  }

  if (parsed.kind === "proposal") {
    const proposalId = parsed.value as bigint;
    if (proposalId <= 0n) return { kind: "invalid", identifier };

    // The contract publishes how many proposals exist, so an id beyond that range
    // is definitively unknown without issuing a doomed read.
    const config = await core.getConfig();
    if (proposalId > config.proposalCount) {
      return { kind: "invalid", identifier };
    }

    try {
      return {
        kind: "proposal",
        proposalId,
        record: await loadProposalRecord(proposalId, core),
      };
    } catch (error) {
      if (isAppError(error) && error.kind === "not_found") {
        return { kind: "invalid", identifier };
      }
      throw error;
    }
  }

  const actionId = parsed.value as string;

  let action: AdminAction;
  try {
    action = await admin.getAction(actionId);
  } catch (error) {
    if (isAppError(error) && error.kind === "not_found") {
      return { kind: "invalid", identifier };
    }

    /**
     * Verified against the deployed contract: an action id the contract never
     * allocated is rejected by the network as an unreadable execution failure,
     * indistinguishable here from a transient read problem. Rather than claim the
     * record does not exist, the surface reports that the lookup could not be
     * completed.
     */
    return { kind: "lookup_failed", identifier, error: toAppError(error) };
  }

  const [appliedToCore, config] = await Promise.all([
    core.isAdminActionApplied(actionId),
    core.getConfig(),
  ]);

  const historyTotal = Number(config.governanceHistoryCount);
  const recent = await readNewest<GovernanceEvent>(
    historyTotal,
    HISTORY_SCAN_LIMIT,
    (offset, limit) => core.getGovernanceHistory(offset, limit),
  );

  return {
    kind: "action",
    actionId,
    action,
    appliedToCore,
    pullRejection: indexPullRejections(recent).get(actionId) ?? null,
    now: nowUnixSeconds(),
  };
}

