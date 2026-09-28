import {
  toAdminAction,
  toAdminSnapshot,
  toDisputeSafetyParams,
  toList,
  toPendingAdminAction,
  toRateLimitParams,
} from "@/domain/mappers";
import type {
  AdminAction,
  AdminSnapshot,
  DisputeSafetyParams,
  PendingAdminAction,
  RateLimitParams,
} from "@/domain/types";
import {
  asReadFailure,
  getDefaultConnection,
  readContractView,
  submitContractWrite,
  type CalldataValue,
  type ResolvedConnection,
  type WriteOptions,
  type WriteOutcome,
} from "./client";

/**
 * GovLayerAdmin adapter.
 *
 * GovLayerAdmin authorizes; GovLayerCore applies. Nothing in this adapter
 * reaches into Core, mirroring the contracts themselves -- confirming that an
 * authorized action was actually applied is GovLayerCoreAdapter's job.
 */

export interface AdminTokenRulesInput {
  readonly votingToken: string;
  readonly minTokensToVote: bigint;
  readonly minTokensToPropose: bigint;
  readonly customTokenInterfaceKind?: string;
}

export interface AdminVotingParametersInput {
  readonly minQuorum: bigint;
  readonly approvalThresholdPercent: bigint;
  readonly minVotingDuration: bigint;
  readonly maxVotingDuration: bigint;
}

export interface AdminWhitelistBatchInput {
  /** "voter" or "proposer". */
  readonly target: string;
  readonly addAddresses: readonly string[];
  readonly removeAddresses: readonly string[];
}

export class GovLayerAdminAdapter {
  /**
   * The connection is resolved per operation rather than at construction, so a
   * missing configuration becomes a failed read instead of a render-time crash
   * (see `getDefaultConnection`).
   */
  private readonly explicitConnection: ResolvedConnection | undefined;

  constructor(connection?: ResolvedConnection) {
    this.explicitConnection = connection;
  }

  private connection(): ResolvedConnection {
    return this.explicitConnection ?? getDefaultConnection();
  }

  get address(): string {
    return this.connection().config.adminAddress;
  }

  private read(
    functionName: string,
    args?: readonly CalldataValue[],
  ): Promise<unknown> {
    let connection: ResolvedConnection;
    try {
      connection = this.connection();
    } catch (error) {
      return Promise.reject(asReadFailure(error));
    }

    return readContractView(
      {
        address: connection.config.adminAddress,
        functionName,
        ...(args === undefined ? {} : { args }),
      },
      connection,
    );
  }

  private write(
    functionName: string,
    args: readonly CalldataValue[] = [],
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    let connection: ResolvedConnection;
    try {
      connection = this.connection();
    } catch (error) {
      return Promise.reject(asReadFailure(error));
    }

    return submitContractWrite(
      { address: connection.config.adminAddress, functionName, args },
      options,
      connection,
    );
  }

  // -- Reads ---------------------------------------------------------------

  async isAdmin(address: string): Promise<boolean> {
    return asBoolean(await this.read("is_admin", [address]));
  }

  async getAdmins(): Promise<string[]> {
    const raw = await this.read("get_admins");
    if (!Array.isArray(raw)) {
      throw new TypeError("get_admins did not return a list");
    }
    return raw.map((entry) => String(entry));
  }

  async getActiveAdminCount(): Promise<number> {
    return asCount(await this.read("get_active_admin_count"));
  }

  async isBootstrapComplete(): Promise<boolean> {
    return asBoolean(await this.read("is_bootstrap_complete"));
  }

  /** Approvals a new action would need right now (threshold table lookup). */
  async getCurrentThreshold(): Promise<number> {
    return asCount(await this.read("get_current_threshold"));
  }

  /**
   * The emergency-pause flag. This is what GovLayerCore reads live before
   * accepting a proposal submission. It gates submission only.
   */
  async isPaused(): Promise<boolean> {
    return asBoolean(await this.read("is_paused"));
  }

  async getRateLimitParams(): Promise<RateLimitParams> {
    return toRateLimitParams(await this.read("get_rate_limit_params"));
  }

  async getDisputeSafetyParams(): Promise<DisputeSafetyParams> {
    return toDisputeSafetyParams(await this.read("get_dispute_safety_params"));
  }

  async getAction(actionId: string): Promise<AdminAction> {
    return toAdminAction(await this.read("get_action", [actionId]));
  }

  /**
   * Currently active actions only: pending approvals or timelocked.
   * Executed and expired actions are not enumerable through any contract view;
   * fetching them requires a known action id.
   */
  async getPendingActions(
    offset: number,
    limit: number,
  ): Promise<PendingAdminAction[]> {
    return toList(
      await this.read("get_pending_actions", [BigInt(offset), BigInt(limit)]),
      toPendingAdminAction,
      "pending admin actions",
    );
  }

  /**
   * Five independent reads, issued together rather than in sequence.
   * `paused` is a live value from Admin itself, never inferred from Core.
   */
  async getSnapshot(): Promise<AdminSnapshot> {
    const [admins, activeAdminCount, bootstrapComplete, currentThreshold, paused] =
      await Promise.all([
        this.getAdmins(),
        this.getActiveAdminCount(),
        this.isBootstrapComplete(),
        this.getCurrentThreshold(),
        this.isPaused(),
      ]);

    return toAdminSnapshot({
      admins,
      activeAdminCount,
      bootstrapComplete,
      currentThreshold,
      paused,
    });
  }

  // -- Writes: multisig proposals -------------------------------------------
  // Every propose_* returns the new action id on chain. The SDK returns the
  // transaction result, so the action id is read back from Admin's own state
  // (see the stewardship phase) rather than trusted from the transaction.
  // Argument order mirrors the contract signatures exactly.

  /** Bootstrap only: adds the second admin. Rejected once bootstrap is done. */
  proposeBootstrapAdmin(
    newAdminAddress: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("add_admin", [newAdminAddress], options);
  }

  proposeAddAdmin(
    targetAddress: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("propose_add_admin", [targetAddress], options);
  }

  proposeRemoveAdmin(
    targetAddress: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("propose_remove_admin", [targetAddress], options);
  }

  /**
   * Authorizes Core to apply a constitution update that Core already voted
   * through. Admin never touches Core's proposal state.
   */
  proposeConstitutionUpdate(
    proposalId: bigint,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("propose_constitution_update", [proposalId], options);
  }

  proposeSetRateLimitParams(
    maxProposalsPerWindow: bigint,
    proposalRateWindowSecs: bigint,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write(
      "propose_set_rate_limit_params",
      [maxProposalsPerWindow, proposalRateWindowSecs],
      options,
    );
  }

  proposeSetEligibilityMode(
    newEligibilityMode: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write(
      "propose_set_eligibility_mode",
      [newEligibilityMode],
      options,
    );
  }

  proposeSetTokenRules(
    input: AdminTokenRulesInput,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write(
      "propose_set_token_rules",
      [
        input.votingToken,
        input.minTokensToVote,
        input.minTokensToPropose,
        input.customTokenInterfaceKind ?? "",
      ],
      options,
    );
  }

  proposeSetVotingWeightMode(
    newVotingWeightMode: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write(
      "propose_set_voting_weight_mode",
      [newVotingWeightMode],
      options,
    );
  }

  proposeSetWhitelistEnabled(
    target: string,
    enabled: boolean,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("propose_set_whitelist_enabled", [target, enabled], options);
  }

  proposeUpdateWhitelist(
    input: AdminWhitelistBatchInput,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write(
      "propose_update_whitelist",
      [input.target, [...input.addAddresses], [...input.removeAddresses]],
      options,
    );
  }

  proposeSetVotingParameters(
    input: AdminVotingParametersInput,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write(
      "propose_set_voting_parameters",
      [
        input.minQuorum,
        input.approvalThresholdPercent,
        input.minVotingDuration,
        input.maxVotingDuration,
      ],
      options,
    );
  }

  proposePause(options: WriteOptions = {}): Promise<WriteOutcome> {
    return this.write("propose_pause", [], options);
  }

  proposeUnpause(options: WriteOptions = {}): Promise<WriteOutcome> {
    return this.write("propose_unpause", [], options);
  }

  // -- Writes: multisig flow ------------------------------------------------

  /**
   * Records one approval. The action's proposer already counts as their first
   * approval and cannot approve their own action again. An approval window
   * that has elapsed is formalized as `expired` without reverting.
   */
  approveAdminAction(
    actionId: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("approve_admin_action", [actionId], options);
  }

  /**
   * Permissionless. Executes a timelocked action whose ready time has passed.
   *
   * Execution re-validates the action against current state: if it no longer
   * holds, the action is formalized as `expired` without reverting -- so a
   * successful transaction here can still mean "expired, not executed". Always
   * re-read `getAction` afterwards.
   */
  executeAdminAction(
    actionId: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("execute_admin_action", [actionId], options);
  }
}


function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (value === "0" || value === "1") return value === "1";
  throw new TypeError(
    `Expected a boolean from the contract, received ${JSON.stringify(value)}`,
  );
}

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new TypeError(
    `Expected an integer count from the contract, received ${JSON.stringify(value)}`,
  );
}
