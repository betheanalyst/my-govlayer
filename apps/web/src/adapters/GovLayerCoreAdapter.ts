import { AppError } from "@/lib/errors";
import {
  toConstitutionVersion,
  toGovernanceConfig,
  toGovernanceEvent,
  toList,
  toProposal,
  toProposalRevision,
} from "@/domain/mappers";
import type {
  ConstitutionVersion,
  GovernanceConfig,
  GovernanceEvent,
  Proposal,
  ProposalRevision,
} from "@/domain/types";
import {
  getDefaultConnection,
  readContractView,
  submitContractWrite,
  type CalldataValue,
  type ResolvedConnection,
  type WriteOptions,
  type WriteOutcome,
} from "./client";

/**
 * GovLayerCore adapter.
 *
 * Every read and write against GovLayerCore goes through here; nothing else in
 * the app knows a contract address or a function name (Foundation Standard
 * section 2.6). Values returned to the UI are domain models, never raw
 * calldata-encoded shapes.
 */

export interface SubmitProposalInput {
  readonly title: string;
  readonly description: string;
  /** Seconds; must sit within the configured min/max voting duration. */
  readonly votingDuration: bigint;
  readonly proposalType: "standard" | "constitution";
  /** Required when proposalType is "constitution". */
  readonly proposedConstitution?: string;
}

export class GovLayerCoreAdapter {
  private readonly connection: ResolvedConnection;

  constructor(connection: ResolvedConnection = getDefaultConnection()) {
    this.connection = connection;
  }

  get address(): string {
    return this.connection.config.coreAddress;
  }

  private read(functionName: string, args?: readonly CalldataValue[]): Promise<unknown> {
    return readContractView(
      {
        address: this.address,
        functionName,
        ...(args === undefined ? {} : { args }),
      },
      this.connection,
    );
  }

  private write(
    functionName: string,
    args: readonly CalldataValue[],
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return submitContractWrite(
      { address: this.address, functionName, args },
      options,
      this.connection,
    );
  }

  // -- Reads ---------------------------------------------------------------

  /** Full governance configuration, including counters used for paging. */
  async getConfig(): Promise<GovernanceConfig> {
    return toGovernanceConfig(await this.read("get_config"));
  }

  /**
   * A single proposal record.
   *
   * Verified against the deployed contract: `get_proposal` does **not** revert for
   * an unknown id, it returns an empty record. That is a definitive "no such
   * proposal", so it is reported as not-found rather than as a read failure.
   */
  async getProposal(proposalId: bigint): Promise<Proposal> {
    const raw = await this.read("get_proposal", [proposalId]);

    if (raw === null || typeof raw !== "object" || Object.keys(raw).length === 0) {
      throw new AppError({
        kind: "not_found",
        message: `Proposal ${proposalId.toString()} does not exist on chain.`,
        raw: "get_proposal returned an empty record",
      });
    }

    return toProposal(raw);
  }

  /** Oldest-first page of proposals. Offset is 0-based. */
  async listProposals(offset: number, limit: number): Promise<Proposal[]> {
    return toList(
      await this.read("list_proposals", [BigInt(offset), BigInt(limit)]),
      toProposal,
      "proposal list",
    );
  }

  async getGovernanceHistory(
    offset: number,
    limit: number,
  ): Promise<GovernanceEvent[]> {
    return toList(
      await this.read("get_governance_history", [BigInt(offset), BigInt(limit)]),
      toGovernanceEvent,
      "governance history",
    );
  }

  async getProposalRevisions(
    proposalId: bigint,
    offset: number,
    limit: number,
  ): Promise<ProposalRevision[]> {
    return toList(
      await this.read("get_proposal_revisions", [
        proposalId,
        BigInt(offset),
        BigInt(limit),
      ]),
      toProposalRevision,
      "proposal revisions",
    );
  }

  /** Oldest-first page of constitution versions (offset 0 is version 1). */
  async getConstitutionHistory(
    offset: number,
    limit: number,
  ): Promise<ConstitutionVersion[]> {
    return toList(
      await this.read("get_constitution_history", [BigInt(offset), BigInt(limit)]),
      toConstitutionVersion,
      "constitution history",
    );
  }

  async isVoterWhitelisted(address: string): Promise<boolean> {
    return asBoolean(await this.read("is_voter_whitelisted", [address]));
  }

  async isProposerWhitelisted(address: string): Promise<boolean> {
    return asBoolean(await this.read("is_proposer_whitelisted", [address]));
  }

  /** Whether Core has actually applied a given authorized action. */
  async isAdminActionApplied(actionId: string): Promise<boolean> {
    return asBoolean(await this.read("is_admin_action_applied", [actionId]));
  }

  /**
   * Whether Core has an Admin contract wired at all. When false, proposal
   * submission is refused by the contract itself.
   */
  async isAdminContractConfigured(): Promise<boolean> {
    return asBoolean(await this.read("is_admin_contract_configured"));
  }

  // -- Writes --------------------------------------------------------------
  // Argument order mirrors the contract signatures exactly.
  // Every write returns a WriteOutcome that must be classified by the caller:
  // a finalized transaction is not by itself a successful operation.

  async submitProposal(
    input: SubmitProposalInput,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write(
      "submit_proposal",
      [
        input.title,
        input.description,
        input.votingDuration,
        input.proposalType,
        input.proposedConstitution ?? "",
      ],
      options,
    );
  }

  /** One immutable vote. A second attempt from the same address reverts. */
  async vote(
    proposalId: bigint,
    support: boolean,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("vote", [proposalId, support], options);
  }

  /**
   * Permissionless. Only valid once the voting window has closed.
   * Sets `passed` / `failed`, or `pending_constitution_confirm` for a
   * constitution-type proposal that passed its vote.
   */
  async finalizeDecision(
    proposalId: bigint,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("finalize_decision", [proposalId], options);
  }

  /** Proposer-only. Valid only while the proposal needs revision. */
  async resubmitProposal(
    proposalId: bigint,
    newDescription: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("resubmit_proposal", [proposalId, newDescription], options);
  }

  /** Proposer-only. Valid while pending or needing revision. */
  async cancelProposal(
    proposalId: bigint,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("cancel_proposal", [proposalId], options);
  }

  /** Proposer or a recorded voter; only on an AI-rejected proposal. */
  async raiseDispute(
    proposalId: bigint,
    reason: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("raise_dispute", [proposalId, reason], options);
  }

  /**
   * Permissionless pull of an executed GovLayerAdmin action.
   *
   * Two different non-applications are possible and must be distinguished by
   * the caller: a hard revert (nothing was pulled) and a graceful pull
   * rejection, which reverts nothing but permanently declines the change.
   * `isAdminActionApplied` after the fact is the authoritative answer.
   */
  async applyAdminAction(
    actionId: string,
    options: WriteOptions = {},
  ): Promise<WriteOutcome> {
    return this.write("apply_admin_action", [actionId], options);
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
