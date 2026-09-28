"use client";

import Link from "next/link";
import { adminActionStageLabel, adminActionTypeLabel } from "@/domain/labels";
import { deriveAdminActionStage } from "@/domain/state";
import { approvalWindowState, actionApplier } from "@/domain/stewardship";
import { formatUtcTimestamp } from "@/lib/time";
import type { PendingAdminAction } from "@/domain/types";
import { StateBadge } from "@/components/shared/StateBadge";

/**
 * The fields both action shapes provide: `get_pending_actions` rows and full
 * action records from `get_action`. Rows are rendered structurally so one list
 * serves the overview and the full action history.
 */
export type ActionRow = Pick<
  PendingAdminAction,
  | "actionId"
  | "actionType"
  | "status"
  | "rawStatus"
  | "proposedAt"
  | "expiresAt"
  | "readyAt"
  | "validApprovalsNow"
>;

/**
 * Authorized-action rows.
 *
 * Shared by the overview and the full action list. Rows state the stage, the
 * recorded approvals against what is currently required, and whichever timing
 * fact matters at that stage — never a countdown that has already passed.
 */
export function ActionSummaryList({
  actions,
  now,
  emptyText,
  requiredApprovalsFor,
}: {
  readonly actions: readonly ActionRow[];
  readonly now: number;
  readonly emptyText: string;
  /**
   * Required approvals for a row. The live threshold comes from
   * `get_current_threshold`, which is what execution compares against; actions
   * read individually also carry their own `current_threshold`.
   */
  readonly requiredApprovalsFor?: (action: ActionRow) => number | null;
}) {
  if (actions.length === 0) {
    return <p className="mt-3 text-sm text-ink-muted">{emptyText}</p>;
  }

  return (
    <ul className="mt-4 space-y-3">
      {actions.map((action) => {
        const stage = deriveAdminActionStage(action, now);
        const windowState = approvalWindowState(action, now);
        const applier = actionApplier(action.actionType);

        return (
          <li
            key={action.actionId}
            className="rounded-card border border-line bg-surface-raised p-5"
          >
            <div className="flex flex-wrap items-center gap-3">
              <StateBadge
                label={adminActionStageLabel(stage)}
                tone={
                  stage === "ready_to_execute"
                    ? "positive"
                    : stage === "awaiting_timelock"
                      ? "info"
                      : stage === "expired"
                        ? "neutral"
                        : "caution"
                }
              />
              <span className="text-sm text-ink">
                {adminActionTypeLabel(action.actionType)}
              </span>
              <span className="code-value text-xs text-ink-subtle">
                {action.actionId}
              </span>
            </div>

            <p className="mt-3 text-xs text-ink-subtle">
              Approvals recorded: {action.validApprovalsNow}
              {requiredApprovalsFor === undefined
                ? ""
                : (() => {
                    const required = requiredApprovalsFor(action);
                    return required === null ? "" : ` of ${required} required`;
                  })()}
              {" · "}
              Proposed {formatUtcTimestamp(action.proposedAt)} UTC
            </p>

            {windowState.state === "open" ? (
              <p className="mt-1 text-xs text-ink-subtle">
                Approval window closes {formatUtcTimestamp(windowState.closesAt)} UTC.
              </p>
            ) : null}

            {windowState.state === "elapsed" ? (
              <p className="mt-1 max-w-prose text-xs text-state-review-revision">
                The approval window has elapsed. The contract will record this as
                expired the next time anyone approves or executes it — a recorded
                outcome, not an error.
              </p>
            ) : null}

            {stage === "awaiting_timelock" ? (
              <p className="mt-1 text-xs text-ink-subtle">
                Timelock completes {formatUtcTimestamp(action.readyAt)} UTC.
              </p>
            ) : null}

            {stage === "ready_to_execute" ? (
              <p className="mt-1 max-w-prose text-xs text-ink-subtle">
                Executable now, by anyone. Execution re-validates the action against
                current state before applying it.
              </p>
            ) : null}

            <p className="mt-2 max-w-prose text-xs text-ink-subtle">
              {applier === "core"
                ? "GovLayerCore applies this one when it is pulled."
                : applier === "admin"
                  ? "GovLayerAdmin applies this one itself at execution."
                  : "This interface does not recognise this action type, so it does not describe who applies it."}
            </p>

            <p className="mt-3 text-sm">
              <Link href={`/stewardship/actions/${action.actionId}`} className="underline">
                Open this action
              </Link>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
