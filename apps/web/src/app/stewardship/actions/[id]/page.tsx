"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { adminActionTypeLabel } from "@/domain/labels";
import { describeActionEffect } from "@/domain/stewardship";
import { isAppError } from "@/lib/errors";
import { useAdminAction, useAdminMembership } from "@/queries/adminQueries";
import { useCoreApplication } from "@/queries/stewardshipQueries";
import { useWallet } from "@/wallet/WalletProvider";
import { ActionPipeline } from "@/components/stewardship/ActionPipeline";
import { ActionRecord } from "@/components/stewardship/ActionRecord";
import { ActionControls } from "@/components/stewardship/ActionControls";
import { PageHeader, Panel } from "@/components/shared/Primitives";
import { StateBadge } from "@/components/shared/StateBadge";
import { deriveAdminActionStage } from "@/domain/state";
import { adminActionStageLabel } from "@/domain/labels";

/**
 * One authorized action (Experience Blueprint section 10.17).
 *
 * The pipeline is shown in full — including Core validation and application —
 * because reaching `executed` on the stewardship contract is an authorization,
 * not proof that the change took effect.
 */
export default function StewardshipActionPage() {
  const params = useParams<{ id: string }>();
  const actionId = decodeURIComponent(params.id);
  const wallet = useWallet();
  const membership = useAdminMembership(wallet.address ?? undefined);
  const action = useAdminAction(actionId);
  const application = useCoreApplication(actionId, action.data !== undefined);

  const now = Math.floor(Date.now() / 1000);

  if (action.isLoading) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Stewardship" title="Reading the authorized action…" />
      </main>
    );
  }

  if (action.isError || action.data === undefined) {
    if (isAppError(action.error) && action.error.kind === "not_found") {
      return (
        <main className="mx-auto max-w-shell px-6 py-16">
          <PageHeader
            eyebrow="Stewardship"
            title="No authorized action here"
            lede={`The stewardship contract holds no action with the id "${actionId}".`}
          />
          <p className="mt-6 text-sm">
            <Link href="/stewardship/actions" className="underline">
              Browse the authorized actions
            </Link>
          </p>
        </main>
      );
    }

    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Stewardship" title="This action could not be read" />
        <p className="mt-6 max-w-prose text-sm text-ink-muted">
          The authorized action could not be verified right now. This is not a
          statement about the action itself. Retry in a moment.
        </p>
      </main>
    );
  }

  const record = action.data;
  const stage = deriveAdminActionStage(record, now);

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow={`Stewardship · ${record.actionId}`}
        title={adminActionTypeLabel(record.actionType)}
        lede={describeActionEffect(record.actionType)}
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
          <span className="code-value text-xs text-ink-subtle">{record.actionId}</span>
        </div>
      </PageHeader>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-10">
          <ActionPipeline action={record} application={application.data} now={now} />
          <ActionControls
            action={record}
            isAdmin={membership.data === true}
            now={now}
          />
        </div>

        <aside className="space-y-6">
          <ActionRecord action={record} application={application.data} now={now} />

          {application.isError ? (
            <Panel tone="sunken">
              <p className="text-sm text-ink">
                GovLayerCore&rsquo;s answer could not be read
              </p>
              <p className="mt-2 max-w-prose text-sm text-ink-muted">
                Whether this authorization was applied is unknown right now. Unknown
                is not the same as not applied, so this interface does not claim
                either.
              </p>
            </Panel>
          ) : null}

          <p className="text-sm">
            <Link href="/stewardship/actions" className="underline">
              All authorized actions
            </Link>
            {" · "}
            <Link href="/verify" className="underline">
              Verify a record
            </Link>
          </p>
        </aside>
      </div>
    </main>
  );
}
