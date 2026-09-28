"use client";

import { formatDuration, formatUtcTimestamp } from "@/lib/time";
import { cn } from "@/lib/cn";
import { deriveAdminActionStage, timelockRemaining } from "@/domain/state";
import { actionApplier, approvalWindowState } from "@/domain/stewardship";
import type { AdminAction } from "@/domain/types";
import type { CoreApplicationResult } from "@/queries/stewardshipQueries";
import { Panel } from "@/components/shared/Primitives";

/**
 * Admin Action Detail (Experience Blueprint section 10.17).
 *
 * The pipeline ends in Core validation and application, because those last steps
 * are not Admin's to decide: `executed` on GovLayerAdmin is authorization, and
 * only GovLayerCore answers whether the change took effect.
 */

interface PipelineStep {
  readonly label: string;
  readonly state: "done" | "current" | "pending" | "declined";
  readonly detail: string;
}

export function ActionPipeline({
  action,
  application,
  now,
}: {
  readonly action: AdminAction;
  readonly application: CoreApplicationResult | undefined;
  readonly now: number;
}) {
  const applier = actionApplier(action.actionType);
  const stage = deriveAdminActionStage(action, now);
  const windowState = approvalWindowState(action, now);
  const timelock = timelockRemaining(action, now);

  const steps: PipelineStep[] = [
    {
      label: "Change proposed",
      state: "done",
      detail: `${formatUtcTimestamp(action.proposedAt)} UTC by ${action.proposer}`,
    },
    {
      label: "Steward approvals",
      state: stage === "awaiting_approvals" ? "current" : "done",
      detail:
        windowState.state === "elapsed"
          ? `Approval window elapsed ${formatUtcTimestamp(windowState.closedAt)} UTC`
          : `${action.validApprovalsNow} recorded · ${action.currentThreshold} required at the last read`,
    },
    {
      label: "Threshold reached",
      state: action.thresholdReachedAt > 0 ? "done" : "pending",
      detail:
        action.thresholdReachedAt > 0
          ? `${formatUtcTimestamp(action.thresholdReachedAt)} UTC`
          : "Not reached yet",
    },
    {
      label: "Timelock",
      state:
        action.readyAt === 0 ? "pending" : timelock === null ? "done" : "current",
      detail:
        action.readyAt === 0
          ? "Starts once the threshold is reached"
          : timelock === null
            ? `Elapsed ${formatUtcTimestamp(action.readyAt)} UTC`
            : `${formatDuration(timelock)} remaining · executable from ${formatUtcTimestamp(action.readyAt)} UTC`,
    },
    {
      label: "Execution",
      state:
        stage === "expired"
          ? "declined"
          : stage === "executed"
            ? "done"
            : stage === "ready_to_execute"
              ? "current"
              : "pending",
      detail:
        stage === "expired"
          ? "Recorded as expired instead of executed"
          : stage === "executed"
            ? "Executed — authorization recorded"
            : stage === "ready_to_execute"
              ? "Ready: anyone may execute it"
              : "Waiting on the timelock",
    },
  ];


  if (applier === "core") {
    steps.push(
      {
        label: "Core validation",
        state:
          application === undefined
            ? "pending"
            : application.applied || application.rejection !== null
              ? "done"
              : action.status === "executed"
                ? "current"
                : "pending",
        detail:
          application === undefined
            ? "Read from GovLayerCore"
            : application.rejection !== null
              ? "Core validated it and declined it permanently"
              : application.applied
                ? "Core validated it and applied the change"
                : "Not pulled yet — Core records no application",
      },
      {
        label: "Applied",
        state:
          application === undefined
            ? "pending"
            : application.applied
              ? "done"
              : application.rejection !== null
                ? "declined"
                : "pending",
        detail:
          application === undefined
            ? "Read from GovLayerCore"
            : application.applied
              ? application.appliedAt === null
                ? "Applied"
                : `Applied ${formatUtcTimestamp(application.appliedAt)} UTC`
              : application.rejection === null
                ? "Not applied"
                : `Declined permanently: ${application.rejection.reason}`,
      },
    );
  }

  return (
    <Panel tone="sunken">
      <ol className="space-y-4">
        {steps.map((step) => (
          <li key={step.label} className="flex gap-4">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                step.state === "done"
                  ? "bg-state-determination-passed"
                  : step.state === "current"
                    ? "bg-accent"
                    : step.state === "declined"
                      ? "bg-state-determination-failed"
                      : "bg-line-strong",
              )}
            />
            <div>
              <p
                className={cn(
                  "text-sm",
                  step.state === "pending" ? "text-ink-subtle" : "text-ink",
                )}
              >
                {step.label}
              </p>
              <p className="mt-0.5 max-w-prose text-xs text-ink-muted">
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-medium text-ink">
          Stewards authorize. GovLayerCore applies.
        </p>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          {applier === "admin"
            ? "This action type is applied by GovLayerAdmin itself at execution, so reaching executed means the change took effect on the stewardship contract."
            : applier === "core"
              ? "This action type is not applied by GovLayerAdmin at all: reaching executed is the authorization, and the change takes effect only when GovLayerCore pulls the record and validates it against its own current state. Core can decline it permanently if that state changed after authorization."
              : "This interface does not recognise this action type, so it does not claim who applies it."}
        </p>
      </div>
    </Panel>
  );
}
