"use client";

import Link from "next/link";
import { useState } from "react";
import { formatInteger } from "@/lib/format";
import { compareActionIdsDescending } from "@/domain/stewardship";
import { useScannedAdminActions } from "@/queries/stewardshipQueries";
import { useAdminSnapshot } from "@/queries/adminQueries";
import { ActionSummaryList } from "@/components/stewardship/ActionSummaryList";
import { PageHeader, Panel, SectionHeading } from "@/components/shared/Primitives";
import { UnverifiedNotice } from "@/components/shared/Notices";

/**
 * Every authorized action.
 *
 * GovLayerAdmin exposes only the *active* actions, so this surface walks the
 * action-id space to reach executed and expired records as well. The walk is
 * bounded and its cost and completeness are stated rather than hidden.
 */
export default function StewardshipActionsPage() {
  const [maxScan, setMaxScan] = useState(100);
  const scan = useScannedAdminActions({ enabled: true, maxScan });
  const snapshot = useAdminSnapshot();

  const now = Math.floor(Date.now() / 1000);
  const actions = [...(scan.data?.actions ?? [])].sort((left, right) =>
    compareActionIdsDescending(left.actionId, right.actionId),
  );

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Stewardship"
        title="Authorized actions"
        lede="Every authorized action the stewardship contract still holds, newest proposal first. The stewardship contract exposes only the active ones directly, so this list is assembled by walking the action-id space."
      >
        <p className="text-sm">
          <Link href="/stewardship" className="underline">
            Back to stewardship
          </Link>
        </p>
      </PageHeader>

      {scan.isError ? (
        <div className="mt-10">
          <UnverifiedNotice subject="The authorized-action history" error={scan.error} />
        </div>
      ) : (
        <>
          <div className="mt-10">
            <SectionHeading
              title="The whole authorized-action record"
              description="Actions are kept by the contract forever: expired and executed ones remain readable even though they no longer appear among the active set."
            />
          </div>

          <ActionSummaryList
            actions={actions}
            now={now}
            requiredApprovalsFor={() => snapshot.data?.currentThreshold ?? null}
            emptyText={
              scan.data === undefined
                ? "Walking the authorized-action id space…"
                : "No authorized action has been created on this deployment."
            }
          />

          <Panel tone="sunken" className="mt-8">
            {scan.data === undefined ? (
              <p className="text-sm text-ink-muted">
                Reading the authorized-action id space…
              </p>
            ) : (
              <>
                <p className="text-sm text-ink">
                  {formatInteger(BigInt(scan.data.actions.length))} actions found, using{" "}
                  {formatInteger(BigInt(scan.data.reads))} contract reads.
                </p>
                <p className="mt-2 max-w-prose text-sm text-ink-muted">
                  {scan.data.complete
                    ? "The walk reached a confirmed end of the allocated id range, so this list is complete."
                    : scan.data.stoppedAt === null
                      ? "The walk hit its own bound before reaching a confirmed end of the allocated id range, so older actions may exist beyond it."
                      : `The walk stopped at counter ${scan.data.stoppedAt} because the network did not return a readable record for it. That is not evidence about the actions already listed, but it does mean the range beyond that point is unconfirmed.`}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={scan.isFetching}
                    onClick={() => setMaxScan((current) => current + 100)}
                    className="rounded-card border border-line-control px-4 py-2 text-sm text-ink transition-colors duration-state hover:border-ink-muted disabled:cursor-not-allowed disabled:text-ink-subtle"
                  >
                    {scan.isFetching ? "Reading…" : "Scan 100 further"}
                  </button>
                  <button
                    type="button"
                    disabled={scan.isFetching}
                    onClick={() => void scan.refetch()}
                    className="rounded-card border border-line-control px-4 py-2 text-sm text-ink transition-colors duration-state hover:border-ink-muted disabled:cursor-not-allowed disabled:text-ink-subtle"
                  >
                    Re-read the record
                  </button>
                </div>
              </>
            )}
          </Panel>
        </>
      )}
    </main>
  );
}
