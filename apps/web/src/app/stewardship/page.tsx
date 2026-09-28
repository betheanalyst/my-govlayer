"use client";

import Link from "next/link";
import { formatInteger } from "@/lib/format";
import { formatUtcTimestamp } from "@/lib/time";
import { adminActionTypeLabel } from "@/domain/labels";
import { indexAppliedActions } from "@/domain/events";
import {
  bucketStewardshipActions,
  STEWARDSHIP_PRIORITY_DESCRIPTIONS,
  STEWARDSHIP_PRIORITY_LABELS,
} from "@/domain/stewardship";
import { useGovernanceHistoryPage } from "@/queries/coreQueries";
import {
  useAdminMembership,
  useAdminSnapshot,
  usePendingAdminActions,
} from "@/queries/adminQueries";
import { useScannedAdminActions } from "@/queries/stewardshipQueries";
import { useWallet } from "@/wallet/WalletProvider";
import { ConnectWallet } from "@/wallet/ConnectWallet";
import { inspectRuntimeConfig } from "@/config/env";
import { ActionSummaryList } from "@/components/stewardship/ActionSummaryList";
import {
  PageHeader,
  Panel,
  RecordList,
  RecordRow,
  SectionHeading,
} from "@/components/shared/Primitives";
import { StateBadge } from "@/components/shared/StateBadge";
import { UnverifiedNotice, ConfigurationIncompleteNotice } from "@/components/shared/Notices";

/**
 * Stewardship overview (Experience Blueprint section 10.16).
 *
 * GovLayerAdmin presented as protocol stewardship, prioritised exactly as the
 * Blueprint orders it. The two "recent" groups are limited by what the contracts
 * record, and the page says so rather than implying a complete activity feed.
 */
export default function StewardshipPage() {
  const wallet = useWallet();
  const snapshot = useAdminSnapshot();
  const membership = useAdminMembership(wallet.address ?? undefined);
  const pending = usePendingAdminActions(0, 25);
  const history = useGovernanceHistoryPage(0, 40);
  const scan = useScannedAdminActions({ enabled: true, maxScan: 100 });

  const now = Math.floor(Date.now() / 1000);
  const all = scan.data?.actions ?? [];

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Stewardship" title="Protocol stewardship" />
        <div className="mt-10">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  const buckets = bucketStewardshipActions(all, { now });
  const appliedIndex =
    history.data === undefined ? null : indexAppliedActions(history.data.events);

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Stewardship"
        title="Protocol stewardship"
        lede="Stewardship changes are authorized by a multisig behind a mandatory timelock, and the governance contract applies them independently. Nothing here changes instantly."
      />

      <p className="mt-6 max-w-prose text-sm text-ink-muted">
        Stewards authorize; GovLayerCore applies. Reaching “executed” on the
        stewardship contract is an authorization, not proof that a change took
        effect.
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="space-y-12">
          {pending.isError || scan.isError ? (
            <UnverifiedNotice
              subject="The stewardship record"
              error={pending.error ?? scan.error}
            />
          ) : null}

          {(["requires_approval", "timelocked", "ready_to_execute"] as const).map(
            (priority) => (
              <section key={priority} aria-label={STEWARDSHIP_PRIORITY_LABELS[priority]}>
                <SectionHeading
                  title={STEWARDSHIP_PRIORITY_LABELS[priority]}
                  description={STEWARDSHIP_PRIORITY_DESCRIPTIONS[priority]}
                />
                <ActionSummaryList
                  actions={buckets[priority]}
                  now={now}
                  requiredApprovalsFor={() => snapshot.data?.currentThreshold ?? null}
                  emptyText={
                    pending.data === undefined
                      ? "Reading the active authorized actions…"
                      : "Nothing is in this state right now."
                  }
                />
              </section>
            ),
          )}

          <section aria-label={STEWARDSHIP_PRIORITY_LABELS.recently_applied}>
            <SectionHeading
              title={STEWARDSHIP_PRIORITY_LABELS.recently_applied}
              description={STEWARDSHIP_PRIORITY_DESCRIPTIONS.recently_applied}
            />
            {appliedIndex === null ? (
              <p className="mt-3 text-sm text-ink-muted">
                Reading GovLayerCore&rsquo;s record of applied authorizations…
              </p>
            ) : appliedIndex.size === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                GovLayerCore has recorded no applied authorization in the history
                reviewed here. Application is recorded by Core, not by the
                stewardship contract.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {[...appliedIndex.entries()]
                  .sort((left, right) => right[1].timestamp - left[1].timestamp)
                  .slice(0, 8)
                  .map(([actionId, application]) => (
                    <li
                      key={actionId}
                      className="rounded-card border border-line bg-surface-raised p-5"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <StateBadge label="Applied by Core" tone="positive" />
                        <span className="text-sm text-ink">
                          {adminActionTypeLabel(application.actionType)}
                        </span>
                        <span className="code-value text-xs text-ink-subtle">
                          {actionId}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-ink-subtle">
                        Applied {formatUtcTimestamp(application.timestamp)} UTC
                      </p>
                      <p className="mt-3 text-sm">
                        <Link href={`/stewardship/actions/${actionId}`} className="underline">
                          Open this action
                        </Link>
                      </p>
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-3 max-w-prose text-xs text-ink-subtle">
              Read from GovLayerCore&rsquo;s governance history, which is where an
              application is recorded. Action types the stewardship contract applies
              itself — steward membership and the submission pause — leave no
              application time in either contract, so they cannot appear here.
            </p>
          </section>

          <section aria-label={STEWARDSHIP_PRIORITY_LABELS.recently_expired}>
            <SectionHeading
              title={STEWARDSHIP_PRIORITY_LABELS.recently_expired}
              description={STEWARDSHIP_PRIORITY_DESCRIPTIONS.recently_expired}
            />
            <ActionSummaryList
              actions={buckets.recently_expired}
              now={now}
              emptyText="No action in the scanned range is recorded as expired."
            />
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <Panel tone="sunken">
            <p className="text-sm font-medium text-ink">Stewardship now</p>
            {snapshot.data === undefined ? (
              <p className="mt-2 text-sm text-ink-muted">
                Reading the stewardship contract…
              </p>
            ) : (
              <RecordList>
                <RecordRow
                  term="Stewards"
                  value={formatInteger(BigInt(snapshot.data.activeAdminCount))}
                />
                <RecordRow
                  term="Approvals required"
                  value={`${snapshot.data.currentThreshold}`}
                />
                <RecordRow
                  term="Bootstrap"
                  value={
                    snapshot.data.bootstrapComplete
                      ? "Complete"
                      : "Not complete — one steward only"
                  }
                />
                <RecordRow
                  term="New submissions"
                  value={snapshot.data.paused ? "Paused" : "Open"}
                />
              </RecordList>
            )}
            <p className="mt-4 text-xs text-ink-subtle">
              {snapshot.data?.paused === true
                ? "A pause blocks new proposal submissions only: voting, disputing, finalizing, resubmitting and cancelling all continue."
                : "The pause flag is read live by the governance contract before it accepts a submission."}
            </p>
          </Panel>

          <Panel tone="sunken">
            <p className="text-sm font-medium text-ink">Your standing</p>
            {wallet.address === null ? (
              <>
                <p className="mt-2 max-w-prose text-sm text-ink-muted">
                  Reading this area needs no wallet. Approving, proposing and
                  executing do, and each states its own requirement.
                </p>
                <div className="mt-3">
                  <ConnectWallet />
                </div>
              </>
            ) : membership.data === undefined ? (
              <p className="mt-2 text-sm text-ink-muted">
                Checking whether this address is a steward…
              </p>
            ) : (
              <p className="mt-2 max-w-prose text-sm text-ink">
                {membership.data
                  ? "This address is a current steward, so it may propose and approve."
                  : "This address is not a steward. It may still execute an approved action once its timelock has elapsed, and pull an executed action into GovLayerCore."}
              </p>
            )}
          </Panel>

          {scan.data === undefined ? null : (
            <p className="text-xs text-ink-subtle">
              The action history was read by walking the authorized-action id space:
              {" "}
              {formatInteger(BigInt(scan.data.reads))} contract reads
              {scan.data.complete
                ? ", reaching the end of the allocated range."
                : scan.data.stoppedAt === null
                  ? ". The walk hit its bound before a confirmed end, so older actions may exist beyond it."
                  : `. The walk stopped at ${scan.data.stoppedAt} without a confirmed end, so older actions may exist beyond it.`}
            </p>
          )}

          <p className="text-sm">
            <Link href="/stewardship/actions" className="underline">
              Every authorized action
            </Link>
            {" · "}
            <Link href="/stewardship/configuration" className="underline">
              Configuration
            </Link>
            {" · "}
            <Link href="/stewardship/admins" className="underline">
              Stewards
            </Link>
          </p>
        </aside>
      </div>
    </main>
  );
}
