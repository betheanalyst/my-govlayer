"use client";

import { formatUtcTimestamp } from "@/lib/time";
import { adminActionStageLabel } from "@/domain/labels";
import { deriveAdminActionStage } from "@/domain/state";
import { actionApplier } from "@/domain/stewardship";
import type { AdminAction } from "@/domain/types";
import type { CoreApplicationResult } from "@/queries/stewardshipQueries";
import { Panel, RecordList, RecordRow } from "@/components/shared/Primitives";

/** The action's recorded fields, in the contracts' own terms. */
export function ActionRecord({
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

  return (
    <Panel tone="sunken">
      <p className="text-sm font-medium text-ink">Recorded state</p>
      <RecordList>
        <RecordRow term="Action" value={action.actionId} code />
        <RecordRow term="Type" value={action.actionType} code />
        <RecordRow term="Status" value={action.rawStatus} code />
        <RecordRow term="Stage" value={adminActionStageLabel(stage)} />
        <RecordRow
          term="Approvals"
          value={`${action.validApprovalsNow} of ${action.currentThreshold} required`}
        />
        <RecordRow
          term="Proposed"
          value={`${formatUtcTimestamp(action.proposedAt)} UTC`}
        />
        <RecordRow
          term="Approval window ends"
          value={`${formatUtcTimestamp(action.expiresAt)} UTC`}
        />
        <RecordRow
          term="Threshold reached"
          value={
            action.thresholdReachedAt === 0
              ? "Not reached"
              : `${formatUtcTimestamp(action.thresholdReachedAt)} UTC`
          }
        />
        <RecordRow
          term="Executable from"
          value={
            action.readyAt === 0
              ? "Not reached"
              : `${formatUtcTimestamp(action.readyAt)} UTC`
          }
        />
        <RecordRow term="Proposed by" value={action.proposer} code />
        <RecordRow
          term="Applied by"
          value={
            applier === "admin"
              ? "GovLayerAdmin, at execution"
              : applier === "core"
                ? "GovLayerCore, on pull"
                : "Unrecognised action type"
          }
        />
        <RecordRow
          term="Applied to Core"
          value={
            application === undefined
              ? "Not read"
              : application.applied
                ? application.appliedAt === null
                  ? "Yes"
                  : `Yes — ${formatUtcTimestamp(application.appliedAt)} UTC`
                : "No"
          }
        />
        {application?.rejection === null || application?.rejection === undefined ? null : (
          <RecordRow
            term="Core declined it"
            value={`${application.rejection.reason} — ${formatUtcTimestamp(application.rejection.timestamp)} UTC`}
            code
          />
        )}
      </RecordList>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-ink-subtle">
          Recorded payload
        </summary>
        <p className="code-value mt-2 break-all text-xs text-ink-muted">
          {action.params === "" ? "(none)" : action.params}
        </p>
      </details>
    </Panel>
  );
}
