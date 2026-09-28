"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { GovLayerCoreAdapter } from "@/adapters/GovLayerCoreAdapter";
import type { SubmitProposalInput } from "@/adapters/GovLayerCoreAdapter";
import type { WriteOutcome } from "@/adapters/client";
import { proposalStageLabel } from "@/domain/labels";
import { deriveProposalStage } from "@/domain/state";
import { buildWriteReport, type WriteReport } from "@/domain/writeReport";
import { AppError, isAppError } from "@/lib/errors";
import { useWallet } from "@/wallet/WalletProvider";
import { invalidateAfterCoreWrite } from "./invalidation";

/**
 * Participation mutations.
 *
 * Every write follows the same three steps, in this order:
 *
 *   1. the wallet must be usable -- otherwise nothing is attempted, and the
 *      reason is a wallet/network reason, never a protocol answer;
 *   2. the write is submitted and its outcome is classified from the
 *      transaction's own execution result (finalized is not success);
 *   3. protocol state is re-read, and the interface reports what was actually
 *      recorded rather than what was intended.
 *
 * Step 3 is not ceremony. `submit_proposal` and `resubmit_proposal` run a
 * constitutional review inside the transaction, so a submission the person made
 * with the intention of opening a vote can be recorded as `needs_revision` or
 * `rejected` instead. The report says what the contract recorded.
 */

export interface ObserveResult {
  /** Sentence describing the re-read protocol state. */
  readonly sentence: string;
  /** Proposal id, when the write created one. */
  readonly proposalId?: string;
}

interface CoreWriteSpec {
  readonly action: string;
  readonly write: (adapter: GovLayerCoreAdapter) => Promise<WriteOutcome>;
  readonly observe?: (adapter: GovLayerCoreAdapter) => Promise<ObserveResult | null>;
}

async function performCoreWrite(
  spec: CoreWriteSpec,
  adapter: GovLayerCoreAdapter,
  client: QueryClient,
  proposalId?: bigint | string,
): Promise<WriteReport> {
  const outcome = await spec.write(adapter);

  let observed: ObserveResult | null = null;
  if (outcome.kind === "confirmed" && spec.observe !== undefined) {
    try {
      observed = await spec.observe(adapter);
    } catch {
      // A failed confirmation read must not turn a successful transaction into a
      // failure, and it must not be presented as a result either.
      observed = null;
    }
  }

  await invalidateAfterCoreWrite(client, {
    ...(proposalId === undefined ? {} : { proposalId }),
  });

  return buildWriteReport({
    action: spec.action,
    outcome,
    observed: observed?.sentence ?? null,
  });
}

export interface SubmitProposalResult extends WriteReport {
  /** The newly recorded proposal id, when it could be attributed unambiguously. */
  readonly newProposalId: string | null;
}

/**
 * Submits a proposal.
 *
 * The contract returns nothing, so the new id is established by comparing
 * `proposal_count` before and after. Ownership of the newest record is only
 * claimed when the count advanced by exactly one, because two concurrent
 * submissions would otherwise be indistinguishable from here.
 */
export function useSubmitProposal() {
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation<SubmitProposalResult, AppError, SubmitProposalInput>({
    mutationFn: async (input) => {
      const adapter = new GovLayerCoreAdapter(wallet.requireConnection());
      const before = await adapter.getConfig();

      const outcome = await adapter.submitProposal(input, {});

      let newProposalId: string | null = null;
      let observed: string | null = null;

      if (outcome.kind === "confirmed") {
        const after = await adapter.getConfig();
        const advanced = after.proposalCount - before.proposalCount;

        if (advanced === 1n) {
          newProposalId = after.proposalCount.toString();
          const proposal = await adapter.getProposal(after.proposalCount);
          observed = `Proposal #${newProposalId} is recorded with the constitutional-review outcome "${proposal.aiAuditDecision === "" ? proposal.rawStatus : proposal.aiAuditDecision}". Current protocol state: ${proposalStageLabel(deriveProposalStage(proposal, nowSeconds()))}.`;
        } else if (advanced > 1n) {
          observed =
            "More than one proposal was recorded while this transaction was in flight, so this interface will not claim which of them is yours. The newest recorded proposal is shown on Explore.";
        } else {
          observed =
            "The submission transaction finalized, but the proposal count did not advance, so no new proposal was recorded.";
        }
      }

      await invalidateAfterCoreWrite(client, {
        ...(newProposalId === null ? {} : { proposalId: newProposalId }),
      });

      return {
        ...buildWriteReport({ action: "Submit a proposal", outcome, observed }),
        newProposalId,
      };
    },
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Casts one immutable vote.
 *
 * A second attempt from the same address reverts with the contract's own
 * message, which the error registry reports as an existing recorded vote --
 * there is no per-voter view to consult, so the revert is the protocol's answer.
 */
export function useVote() {
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation<
    WriteReport,
    AppError,
    { readonly proposalId: bigint; readonly support: boolean }
  >({
    mutationFn: async ({ proposalId, support }) => {
      const adapter = new GovLayerCoreAdapter(wallet.requireConnection());

      return performCoreWrite(
        {
          action: `Vote ${support ? "yes" : "no"} on proposal #${proposalId.toString()}`,
          write: (core) => core.vote(proposalId, support, {}),
          observe: async (core) => {
            const proposal = await core.getProposal(proposalId);
            return {
              sentence: `Recorded tallies: ${proposal.votesYes.toString()} yes, ${proposal.votesNo.toString()} no. Votes are immutable: an address votes once, and this interface cannot show which way an address voted because the contract records the tally rather than the voter.`,
            };
          },
        },
        adapter,
        client,
        proposalId,
      );
    },
  });
}

/** Permissionless finalization once the voting window has closed. */
export function useFinalizeDecision() {
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation<WriteReport, AppError, { readonly proposalId: bigint }>({
    mutationFn: async ({ proposalId }) => {
      const adapter = new GovLayerCoreAdapter(wallet.requireConnection());

      return performCoreWrite(
        {
          action: `Finalize the determination for proposal #${proposalId.toString()}`,
          write: (core) => core.finalizeDecision(proposalId, {}),
          observe: async (core) => {
            const proposal = await core.getProposal(proposalId);
            return {
              sentence: `The contract records this proposal as "${proposal.rawStatus}"${proposal.failureReason === "" ? "" : ` (reason: ${proposal.failureReason})`}.`,
            };
          },
        },
        adapter,
        client,
        proposalId,
      );
    },
  });
}

/**
 * Resubmits a proposal that needs revision. Proposer-only, and the fresh
 * review runs against the constitution snapshot captured at first submission.
 */
export function useResubmitProposal() {
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation<
    WriteReport,
    AppError,
    { readonly proposalId: bigint; readonly newDescription: string }
  >({
    mutationFn: async ({ proposalId, newDescription }) => {
      const adapter = new GovLayerCoreAdapter(wallet.requireConnection());

      return performCoreWrite(
        {
          action: `Resubmit proposal #${proposalId.toString()} for review`,
          write: (core) =>
            core.resubmitProposal(proposalId, newDescription, {}),
          observe: async (core) => {
            const proposal = await core.getProposal(proposalId);
            return {
              sentence: `The contract records this proposal as "${proposal.rawStatus}"${proposal.aiAuditDecision === "" ? "" : ` after review (${proposal.aiAuditDecision})`}. Resubmissions used: ${proposal.resubmissionCount}.`,
            };
          },
        },
        adapter,
        client,
        proposalId,
      );
    },
  });
}

/** Raises a dispute. Valid only on a proposal that review rejected. */
export function useRaiseDispute() {
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation<
    WriteReport,
    AppError,
    { readonly proposalId: bigint; readonly reason: string }
  >({
    mutationFn: async ({ proposalId, reason }) => {
      const adapter = new GovLayerCoreAdapter(wallet.requireConnection());

      return performCoreWrite(
        {
          action: `Raise a dispute on proposal #${proposalId.toString()}`,
          write: (core) => core.raiseDispute(proposalId, reason, {}),
          observe: async (core) => {
            const proposal = await core.getProposal(proposalId);
            const last = proposal.disputeHistory.at(-1);
            return {
              sentence: `The contract records this proposal as "${proposal.rawStatus}". Dispute stage ${proposal.disputeStage}${last === undefined ? "" : ` was resolved as "${last.resolution}"`}. A reopened proposal gets a fresh voting window; a dispute never approves a proposal by itself.`,
            };
          },
        },
        adapter,
        client,
        proposalId,
      );
    },
  });
}

/** Cancels a proposal. Proposer-only, and only while it is pending or needs revision. */
export function useCancelProposal() {
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation<WriteReport, AppError, { readonly proposalId: bigint }>({
    mutationFn: async ({ proposalId }) => {
      const adapter = new GovLayerCoreAdapter(wallet.requireConnection());

      return performCoreWrite(
        {
          action: `Cancel proposal #${proposalId.toString()}`,
          write: (core) => core.cancelProposal(proposalId, {}),
          observe: async (core) => {
            const proposal = await core.getProposal(proposalId);
            return {
              sentence: `The contract records this proposal as "${proposal.rawStatus}". The record and its review are preserved.`,
            };
          },
        },
        adapter,
        client,
        proposalId,
      );
    },
  });
}

/** Message used when a write failed before the network saw it. */
export function describeWalletFailure(error: unknown): string {
  return isAppError(error)
    ? error.message
    : "This action could not be attempted.";
}

