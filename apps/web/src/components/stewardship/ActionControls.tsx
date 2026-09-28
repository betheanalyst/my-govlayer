"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDuration, formatUtcTimestamp } from "@/lib/time";
import { deriveAdminActionStage, timelockRemaining } from "@/domain/state";
import { actionApplier, approvalWindowState } from "@/domain/stewardship";
import type { AdminAction } from "@/domain/types";
import { useStewardshipAction } from "@/queries/stewardshipWriteHooks";
import { useWallet } from "@/wallet/WalletProvider";
import { Panel } from "@/components/shared/Primitives";
import { WriteResultPanel } from "@/components/participation/WriteResultPanel";

/**
 * Stewardship controls for one action: approve, execute, and — for the action
 * types Core applies — pull it into GovLayerCore.
 *
 * Each control states what the protocol will actually do at this moment,
 * including the graceful outcomes: an approval past its window, or an execution
 * that fails revalidation, is recorded as `expired` rather than reverting.
 */
export function ActionControls({
  action,
  isAdmin,
  now,
}: {
  readonly action: AdminAction;
  readonly isAdmin: boolean;
  readonly now: number;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const stewardship = useStewardshipAction();
  const [confirming, setConfirming] = useState<string | null>(null);

  const stage = deriveAdminActionStage(action, now);
  const windowState = approvalWindowState(action, now);
  const timelock = timelockRemaining(action, now);
  const applier = actionApplier(action.actionType);
  const blocked = wallet.writeBlockedReason;

  async function run(request: {
    readonly kind: "approve" | "execute" | "apply";
    readonly actionId: string;
  }) {
    try {
      await stewardship.mutateAsync(request);
      setConfirming(null);
      router.refresh();
    } catch {
      // Rendered from the mutation's error state below.
    }
  }

  return (
    <Panel>
      <p className="text-sm font-medium text-ink">Available actions</p>

      <ul className="mt-3 space-y-2 text-sm text-ink-muted">
        {stage === "awaiting_approvals" ? (
          <li>
            {isAdmin
              ? "You may approve this action once. The proposer's own approval is already recorded, and an address cannot approve the same action twice."
              : "Approval is restricted to current stewards. Any address may execute an approved action once its timelock has elapsed."}
          </li>
        ) : null}
        {stage === "awaiting_timelock" && timelock !== null ? (
          <li>
            The timelock must elapse before execution:{" "}
            {formatDuration(timelock)} from now, at{" "}
            {formatUtcTimestamp(action.readyAt)} UTC.
          </li>
        ) : null}
        {stage === "ready_to_execute" ? (
          <li>
            Execution is permissionless — any address may execute this, so liveness
            never depends on one steward. It re-validates the action against current
            state first, and records it as expired instead if that state has moved.
          </li>
        ) : null}
        {stage === "executed" ? (
          <li>
            Execution is complete.{" "}
            {applier === "core"
              ? "This action type takes effect only when GovLayerCore pulls it, which is also permissionless."
              : "This action type was applied by GovLayerAdmin itself at execution."}
          </li>
        ) : null}
        {stage === "expired" ? (
          <li>
            This action is recorded as expired. Expiry is a recorded outcome, not a
            failed transaction, and it cannot be revived — a new action would be
            needed.
          </li>
        ) : null}
        {windowState.state === "elapsed" ? (
          <li className="text-state-review-revision">
            The approval window has already elapsed, so approving or executing now
            records this action as expired rather than progressing it.
          </li>
        ) : null}
      </ul>

      <div className="mt-5 flex flex-wrap gap-3">
        {stage === "awaiting_approvals" && windowState.state === "open" ? (
          <button
            type="button"
            disabled={!isAdmin || stewardship.isPending || blocked !== null}
            onClick={() => void run({ kind: "approve", actionId: action.actionId })}
            className="rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stewardship.isPending ? "Waiting for the network…" : "Approve this action"}
          </button>
        ) : null}

        {stage === "ready_to_execute" ? (
          <button
            type="button"
            disabled={stewardship.isPending || blocked !== null}
            onClick={() => void run({ kind: "execute", actionId: action.actionId })}
            className="rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stewardship.isPending ? "Waiting for the network…" : "Execute this action"}
          </button>
        ) : null}

        {applier === "core" && stage === "executed" ? (
          confirming === "apply" ? (
            <span className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={stewardship.isPending || blocked !== null}
                onClick={() => void run({ kind: "apply", actionId: action.actionId })}
                className="rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stewardship.isPending
                  ? "Waiting for the network…"
                  : "Confirm: pull into GovLayerCore"}
              </button>
              <button
                type="button"
                disabled={stewardship.isPending}
                onClick={() => setConfirming(null)}
                className="rounded-card border border-line-control px-5 py-2.5 text-sm text-ink hover:border-ink-muted"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={blocked !== null}
              onClick={() => setConfirming("apply")}
              className="rounded-card border border-line-control px-5 py-2.5 text-sm text-ink hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Pull into GovLayerCore
            </button>
          )
        ) : null}
      </div>

      {confirming === "apply" ? (
        <p className="mt-3 max-w-prose text-xs text-ink-subtle">
          This is a separate permissionless transaction on GovLayerCore. Core
          re-validates the authorization against its own current state and may
          decline it permanently — that outcome is recorded, and shown here.
        </p>
      ) : null}

      {blocked === null ? null : (
        <p className="mt-3 max-w-prose text-xs text-ink-subtle">{blocked}</p>
      )}

      <div className="mt-5">
        <WriteResultPanel
          pending={stewardship.isPending}
          report={stewardship.data ?? null}
          error={stewardship.error ?? null}
        />
      </div>
    </Panel>
  );
}
