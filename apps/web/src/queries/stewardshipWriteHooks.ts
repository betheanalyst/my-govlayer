"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GovLayerAdminAdapter } from "@/adapters/GovLayerAdminAdapter";
import type {
  AdminTokenRulesInput,
  AdminVotingParametersInput,
} from "@/adapters/GovLayerAdminAdapter";
import { GovLayerCoreAdapter } from "@/adapters/GovLayerCoreAdapter";
import type { WriteOutcome } from "@/adapters/client";
import { scanAdminActionHistory } from "@/adapters/actionHistory";
import { indexPullRejections } from "@/domain/events";
import { deriveApplicationState } from "@/domain/state";
import { buildWriteReport, type WriteReport } from "@/domain/writeReport";
import { AppError } from "@/lib/errors";
import { descendingWindow } from "@/lib/pagination";
import { useWallet } from "@/wallet/WalletProvider";
import {
  invalidateAfterAdminWrite,
  invalidateAfterCoreWrite,
} from "./invalidation";

/**
 * Stewardship writes.
 *
 * Every branch follows the same three steps as participation: the wallet must be
 * usable, the transaction's own execution result decides what happened, and
 * protocol state is then re-read. The re-read is load-bearing here, because
 * GovLayerAdmin has three graceful, non-reverting outcomes:
 *
 *   - `approve_admin_action` past the approval window formalizes `expired`;
 *   - `execute_admin_action` past that window, or failing revalidation against
 *     current state, formalizes `expired` instead of applying;
 *   - Core's `apply_admin_action` can permanently reject a pull without
 *     reverting.
 *
 * In all three cases a finalized transaction means something other than what the
 * sender intended, so the report states what the contract actually recorded.
 */

export interface StewardshipResult extends WriteReport {
  /** The action this write concerned, when it is known. */
  readonly actionId: string | null;
  /** Post-pull application state, when this write was a Core pull. */
  readonly applicationState: string | null;
}

export type StewardshipRequest =
  | { readonly kind: "propose_add_admin"; readonly address: string }
  | { readonly kind: "propose_remove_admin"; readonly address: string }
  | { readonly kind: "bootstrap_admin"; readonly address: string }
  | { readonly kind: "propose_constitution_update"; readonly proposalId: bigint }
  | {
      readonly kind: "propose_set_rate_limit_params";
      readonly maxProposalsPerWindow: bigint;
      readonly proposalRateWindowSecs: bigint;
    }
  | { readonly kind: "propose_set_eligibility_mode"; readonly mode: string }
  | {
      readonly kind: "propose_set_token_rules";
      readonly rules: AdminTokenRulesInput;
    }
  | { readonly kind: "propose_set_voting_weight_mode"; readonly mode: string }
  | {
      readonly kind: "propose_set_whitelist_enabled";
      readonly target: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "propose_update_whitelist";
      readonly target: string;
      readonly add: readonly string[];
      readonly remove: readonly string[];
    }
  | {
      readonly kind: "propose_set_voting_parameters";
      readonly parameters: AdminVotingParametersInput;
    }
  | { readonly kind: "propose_pause" }
  | { readonly kind: "propose_unpause" }
  | { readonly kind: "approve"; readonly actionId: string }
  | { readonly kind: "execute"; readonly actionId: string }
  | { readonly kind: "apply"; readonly actionId: string };

/** Human description of the attempted write, used in the result panel. */
export function describeStewardshipRequest(request: StewardshipRequest): string {
  switch (request.kind) {
    case "bootstrap_admin":
      return "Add the second steward (bootstrap)";
    case "propose_add_admin":
      return "Propose adding a steward";
    case "propose_remove_admin":
      return "Propose removing a steward";
    case "propose_constitution_update":
      return `Propose authorizing the constitution amendment from proposal #${request.proposalId.toString()}`;
    case "propose_set_rate_limit_params":
      return "Propose changing proposal rate limits";
    case "propose_set_eligibility_mode":
      return `Propose changing participation mode to "${request.mode}"`;
    case "propose_set_token_rules":
      return "Propose changing token rules";
    case "propose_set_voting_weight_mode":
      return `Propose changing voting weight mode to "${request.mode}"`;
    case "propose_set_whitelist_enabled":
      return `Propose turning the ${request.target} whitelist ${request.enabled ? "on" : "off"}`;
    case "propose_update_whitelist":
      return `Propose a batched ${request.target} whitelist update`;
    case "propose_set_voting_parameters":
      return "Propose changing quorum, threshold and voting-duration bounds";
    case "propose_pause":
      return "Propose pausing new submissions";
    case "propose_unpause":
      return "Propose lifting the submission pause";
    case "approve":
      return `Approve ${request.actionId}`;
    case "execute":
      return `Execute ${request.actionId}`;
    case "apply":
      return `Pull ${request.actionId} into GovLayerCore`;
  }
}

/** Dispatches the `propose_*` requests, or null for the other kinds. */
function runProposal(
  request: StewardshipRequest,
  admin: GovLayerAdminAdapter,
): Promise<WriteOutcome> | null {
  switch (request.kind) {
    case "bootstrap_admin":
      return admin.proposeBootstrapAdmin(request.address, {});
    case "propose_add_admin":
      return admin.proposeAddAdmin(request.address, {});
    case "propose_remove_admin":
      return admin.proposeRemoveAdmin(request.address, {});
    case "propose_constitution_update":
      return admin.proposeConstitutionUpdate(request.proposalId, {});
    case "propose_set_rate_limit_params":
      return admin.proposeSetRateLimitParams(
        request.maxProposalsPerWindow,
        request.proposalRateWindowSecs,
        {},
      );
    case "propose_set_eligibility_mode":
      return admin.proposeSetEligibilityMode(request.mode, {});
    case "propose_set_token_rules":
      return admin.proposeSetTokenRules(request.rules, {});
    case "propose_set_voting_weight_mode":
      return admin.proposeSetVotingWeightMode(request.mode, {});
    case "propose_set_whitelist_enabled":
      return admin.proposeSetWhitelistEnabled(request.target, request.enabled, {});
    case "propose_update_whitelist":
      return admin.proposeUpdateWhitelist(
        {
          target: request.target,
          addAddresses: request.add,
          removeAddresses: request.remove,
        },
        {},
      );
    case "propose_set_voting_parameters":
      return admin.proposeSetVotingParameters(request.parameters, {});
    case "propose_pause":
      return admin.proposePause({});
    case "propose_unpause":
      return admin.proposeUnpause({});
    default:
      return null;
  }
}

/**
 * Reads back the action id a proposal created.
 *
 * The contract returns the id, but a transaction's return value is not what
 * decides an outcome here, so the id is established from Admin's own state: the
 * id space is walked from the last confirmed position, which costs one read in
 * the normal case because the stewardship surfaces warm that memo.
 */
async function readBackNewestAction(
  admin: GovLayerAdminAdapter,
): Promise<{ actionId: string | null; observed: string }> {
  const scan = await scanAdminActionHistory(admin, { maxScan: 25 });

  if (scan.actions.length === 0) {
    return {
      actionId: null,
      observed:
        "The transaction finalized, but no authorized action was found in the action-id space afterwards, so this interface will not claim an action id.",
    };
  }

  const newest = scan.actions.reduce((highest, action) =>
    counterOf(action.actionId) >= counterOf(highest.actionId) ? action : highest,
  );

  return {
    actionId: newest.actionId,
    observed: `The newest authorized action is ${newest.actionId}, recorded as "${newest.rawStatus}" with ${newest.validApprovalsNow} of ${newest.currentThreshold} required approvals. An approval window and a timelock still apply before it can be executed.`,
  };
}

function counterOf(actionId: string): number {
  const parsed = Number.parseInt(actionId.slice("ACTION-".length), 10);
  return Number.isSafeInteger(parsed) ? parsed : -1;
}

/** How much Core history to read when resolving an application outcome. */
const APPLIED_HISTORY_WINDOW = 40;

/**
 * Confirms what Core recorded for an action, after the pull transaction.
 *
 * Three honest outcomes: applied, permanently pull-rejected, or unconfirmed. A
 * finalized transaction is not by itself any of them.
 */
async function observeCoreApplication(
  core: GovLayerCoreAdapter,
  actionId: string,
): Promise<{ applicationState: string; observed: string }> {
  const applied = await core.isAdminActionApplied(actionId);

  const config = await core.getConfig();
  const window = descendingWindow(
    Number(config.governanceHistoryCount),
    0,
    APPLIED_HISTORY_WINDOW,
  );
  const events = window.isEmpty
    ? []
    : await core.getGovernanceHistory(window.offset, window.limit);

  const rejection = indexPullRejections(events).get(actionId) ?? null;

  const state = deriveApplicationState({
    action: { status: "executed" },
    appliedToCore: applied,
    pullRejected: rejection !== null,
  });

  if (state === "applied") {
    return {
      applicationState: state,
      observed:
        "GovLayerCore records this authorization as applied, so the change is in Core's own state.",
    };
  }

  if (state === "pull_rejected") {
    return {
      applicationState: state,
      observed: `GovLayerCore permanently declined this authorization${
        rejection === null ? "" : ` (recorded reason: ${rejection.reason})`
      }. It cannot be pulled again; a new authorized action would be needed.`,
    };
  }

  return {
    applicationState: state,
    observed:
      "GovLayerCore has not recorded this authorization as applied, and no decline is recorded either. Re-check the action before assuming the change took effect.",
  };
}

/**
 * One mutation for every stewardship write.
 *
 * A discriminated request keeps the UI simple while letting each branch do the
 * right re-read: proposals read back their new action id, approvals and
 * executions re-read the action's recorded status, and a pull re-reads Core.
 */
export function useStewardshipAction() {
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation<StewardshipResult, AppError, StewardshipRequest>({
    mutationFn: async (request) => {
      const connection = wallet.requireConnection();
      const admin = new GovLayerAdminAdapter(connection);
      const action = describeStewardshipRequest(request);

      // -- A Core pull: different contract, different trust boundary ---------
      if (request.kind === "apply") {
        const core = new GovLayerCoreAdapter(connection);
        const outcome = await core.applyAdminAction(request.actionId, {});

        let observed: string | null = null;
        let applicationState: string | null = null;

        if (outcome.kind === "confirmed") {
          try {
            const result = await observeCoreApplication(core, request.actionId);
            observed = result.observed;
            applicationState = result.applicationState;
          } catch {
            observed = null;
          }
        }

        await invalidateAfterCoreWrite(client, { actionId: request.actionId });
        await invalidateAfterAdminWrite(client, { actionId: request.actionId });

        return {
          ...buildWriteReport({ action, outcome, observed }),
          actionId: request.actionId,
          applicationState,
        };
      }

      // -- Proposals, approvals and executions -------------------------------
      const proposal = runProposal(request, admin);

      const outcome =
        proposal ??
        (request.kind === "approve"
          ? admin.approveAdminAction(request.actionId, {})
          : request.kind === "execute"
            ? admin.executeAdminAction(request.actionId, {})
            : Promise.reject(
                new AppError({
                  kind: "validation",
                  message: "This stewardship request could not be built.",
                }),
              ));

      const writeOutcome = await outcome;

      let observed: string | null = null;
      let actionId: string | null =
        request.kind === "approve" || request.kind === "execute"
          ? request.actionId
          : null;

      if (writeOutcome.kind === "confirmed") {
        try {
          if (actionId === null) {
            const readBack = await readBackNewestAction(admin);
            actionId = readBack.actionId;
            observed = readBack.observed;
          } else {
            const record = await admin.getAction(actionId);
            observed = `The contract records ${actionId} as "${record.rawStatus}". ${
              record.status === "expired"
                ? "It expired rather than being executed: a recorded outcome, not a failed transaction."
                : record.status === "executed"
                  ? "Execution is authorization only. Whether Core applied it is a separate, recorded answer."
                  : "The multisig and timelock flow continues from here."
            }`;
          }
        } catch {
          // A failed confirmation read never turns a finalized transaction into
          // a reported failure, and is never presented as a result either.
          observed = null;
        }
      }

      await invalidateAfterAdminWrite(client, {
        ...(actionId === null ? {} : { actionId }),
        touchesCore: writeOutcome.kind === "confirmed",
      });

      return {
        ...buildWriteReport({ action, outcome: writeOutcome, observed }),
        actionId,
        applicationState: null,
      };
    },
  });
}
