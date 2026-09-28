import Link from "next/link";
import { inspectRuntimeConfig } from "@/config/env";
import { primaryRpcUrl, resolveNetwork } from "@/config/network";
import {
  adminActionStageLabel,
  adminActionTypeLabel,
  proposalStageLabel,
  proposalStageTone,
} from "@/domain/labels";
import {
  approvalProgress,
  deriveAdminActionStage,
  deriveApplicationState,
  deriveProposalStage,
  summarizeProposal,
  timelockRemaining,
} from "@/domain/state";
import { loadVerificationTarget } from "@/server/reads";
import {
  PageHeader,
  Panel,
  RecordList,
  RecordRow,
  SectionHeading,
} from "@/components/shared/Primitives";
import { StateBadge } from "@/components/shared/StateBadge";
import {
  ConfigurationIncompleteNotice,
  UnverifiedNotice,
} from "@/components/shared/Notices";
import { VerificationPanel } from "@/components/proposal/RecordAndVerification";
import { formatInteger } from "@/lib/format";
import { formatDuration, formatUtcTimestamp } from "@/lib/time";

/**
 * Verification result (Experience Blueprint section 10.13).
 *
 * Resolves one identifier and shows the human layer first, then the technical
 * record. An unresolvable identifier is reported as unresolved -- never mapped
 * onto a plausible record.
 */
export const dynamic = "force-dynamic";

export default async function VerificationResultPage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier: rawIdentifier } = await params;
  const identifier = decodeURIComponent(rawIdentifier);

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Verify" title={identifier} />
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  const target = await loadVerificationTarget(identifier);

  if (target.kind === "invalid") {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="Verify"
          title="No record found"
          lede={`Nothing on chain matches "${identifier}".`}
        />
        <div className="mt-8 max-w-prose space-y-4 text-sm text-ink-muted">
          <p>
            That identifier is either not in a form this surface recognises, or no
            such record exists on chain. Nothing was assumed about what was meant.
          </p>
          <p>
            Use a proposal number (for example{" "}
            <span className="code-value">3</span>) or an authorized action
            identifier (for example{" "}
            <span className="code-value">ACTION-00000003</span>).
          </p>
          <p>
            <Link href="/verify" className="underline">
              Try another identifier
            </Link>{" "}
            ·{" "}
            <Link href="/explore" className="underline">
              Browse proposals
            </Link>
          </p>
        </div>
      </main>
    );
  }

  if (target.kind === "lookup_failed") {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="Verify"
          title="This lookup could not be completed"
          lede={`The contract declined the lookup for "${identifier}", without returning a readable answer.`}
        />
        <div className="mt-8">
          <UnverifiedNotice
            subject="This identifier"
            error={target.error}
          />
          <p className="mt-4 max-w-prose text-sm text-ink-muted">
            This is not a statement that the record does not exist. It means the
            read could not be completed, so no conclusion is drawn about it.
          </p>
          <p className="mt-4 text-sm">
            <Link href="/verify" className="underline">
              Try another identifier
            </Link>{" "}
            ·{" "}
            <Link href="/explore" className="underline">
              Browse proposals
            </Link>
          </p>
        </div>
      </main>
    );
  }

  if (target.kind === "proposal") {
    const { proposal, config: governance, now } = target.record;
    const stage = deriveProposalStage(proposal, now);
    const summary = summarizeProposal(proposal, governance, now);
    const preset = resolveNetwork(inspected.config.network);

    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="Verify · proposal"
          title={`Proposal #${proposal.proposalId.toString()}`}
          lede={proposal.title}
        >
          <div className="flex flex-wrap items-center gap-3">
            <StateBadge
              label={proposalStageLabel(stage)}
              tone={proposalStageTone(stage)}
            />
            <Link
              href={`/proposals/${proposal.proposalId.toString()}`}
              className="text-sm underline"
            >
              Open the full record
            </Link>
          </div>
        </PageHeader>

        <section aria-labelledby="human-heading" className="mt-10 max-w-prose">
          <SectionHeading id="human-heading" title="What this record shows" />
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
            {summary.detail}
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink">
            {summary.nextStep}
          </p>
          <p className="mt-4 text-sm text-ink-muted">
            The contract records this proposal as{" "}
            <span className="code-value">{proposal.rawStatus}</span>, with{" "}
            {formatInteger(proposal.votesYes)} recorded yes and{" "}
            {formatInteger(proposal.votesNo)} recorded no.
          </p>
        </section>

        <div className="mt-12">
          <VerificationPanel
            proposalId={proposal.proposalId.toString()}
            rawStatus={proposal.rawStatus}
            rawFailureReason={proposal.failureReason}
            rawAuditDecision={proposal.aiAuditDecision}
            createdAt={proposal.createdAt}
            votingClosesAt={proposal.votingClosesAt}
            contractAddress={inspected.config.coreAddress}
            networkLabel={preset.label}
            rpcUrl={primaryRpcUrl(preset)}
          />
        </div>
      </main>
    );
  }
  const { action, actionId, appliedToCore, pullRejection, now } = target;
  const stage = deriveAdminActionStage(action, now);
  const progress = approvalProgress(action, action.currentThreshold);
  const timelock = timelockRemaining(action, now);
  const application = deriveApplicationState({
    action,
    appliedToCore,
    pullRejected: pullRejection !== null,
  });

  const applicationSentence =
    application === "applied"
      ? "GovLayerCore has recorded this action as applied. The change took effect."
      : application === "pull_rejected"
        ? "GovLayerCore permanently declined this action: its own state changed after the authorization was granted, so the change did not take effect."
        : application === "awaiting_application"
          ? "The action is authorized and is waiting for GovLayerCore to validate and apply it."
          : application === "awaiting_execution"
            ? "The action has not been executed yet, so there is nothing for GovLayerCore to apply."
            : application === "expired"
              ? "The action expired before it was executed. Nothing was applied."
              : "The application state of this action is not recognised by this interface.";

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Verify · stewardship action"
        title={actionId}
        lede={adminActionTypeLabel(action.actionType)}
      >
        <StateBadge label={adminActionStageLabel(stage)} tone="info" />
      </PageHeader>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section aria-labelledby="action-human-heading" className="max-w-prose">
          <SectionHeading id="action-human-heading" title="What this action does" />
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
            This action authorizes{" "}
            {adminActionTypeLabel(action.actionType).toLowerCase()}. Stewards
            authorize; GovLayerCore applies. Execution on the stewardship contract
            is authorization only — not proof that the change took effect.
          </p>

          <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink">
            {applicationSentence}
          </p>

          {pullRejection === null ? null : (
            <p className="mt-4 text-sm text-ink-muted">
              Recorded reason for the decline:{" "}
              <span className="code-value">{pullRejection.reason}</span> —{" "}
              {formatUtcTimestamp(pullRejection.timestamp)} UTC
            </p>
          )}

          {timelock === null ? null : (
            <p className="mt-4 text-sm text-ink-muted">
              Timelock completes in {formatDuration(timelock)}.
            </p>
          )}
        </section>

        <aside>
          <Panel tone="sunken">
            <p className="text-sm font-medium text-ink">Recorded state</p>
            <RecordList>
              <RecordRow term="Action" value={actionId} code />
              <RecordRow term="Type" value={adminActionTypeLabel(action.actionType)} />
              <RecordRow
                term="Approvals"
                value={`${progress.recorded} of ${progress.required} required`}
              />
              <RecordRow term="Status" value={action.rawStatus} code />
              <RecordRow
                term="Proposed"
                value={`${formatUtcTimestamp(action.proposedAt)} UTC`}
              />
              <RecordRow
                term="Approval window ends"
                value={`${formatUtcTimestamp(action.expiresAt)} UTC`}
              />
              <RecordRow
                term="Executable from"
                value={
                  action.readyAt === 0
                    ? "Not reached"
                    : `${formatUtcTimestamp(action.readyAt)} UTC`
                }
              />
              <RecordRow term="Proposer" value={action.proposer} code />
              <RecordRow term="Applied to Core" value={appliedToCore ? "Yes" : "No"} />
            </RecordList>
          </Panel>

          <p className="mt-4 text-xs text-ink-subtle">
            Recorded payload:{" "}
            <span className="code-value break-all">
              {action.params === "" ? "(none)" : action.params}
            </span>
          </p>

          <p className="mt-4 text-xs text-ink-subtle">
            <Link href="/verify" className="underline">
              Verify another record
            </Link>
          </p>
        </aside>
      </div>
    </main>
  );
}


