import Link from "next/link";
import { notFound } from "next/navigation";
import { inspectRuntimeConfig } from "@/config/env";
import { primaryRpcUrl, resolveNetwork } from "@/config/network";
import { proposalStageLabel, proposalStageTone, proposalTypeLabel } from "@/domain/labels";
import { deriveProposalStage } from "@/domain/state";
import { isAppError } from "@/lib/errors";
import { shortenAddress } from "@/lib/hex";
import { formatUtcTimestamp } from "@/lib/time";
import { loadProposalRecord } from "@/server/reads";
import { MetaChip, StateBadge } from "@/components/shared/StateBadge";
import {
  PageHeader,
  Prose,
  SectionHeading,
  TimingNote,
} from "@/components/shared/Primitives";
import { ConfigurationIncompleteNotice } from "@/components/shared/Notices";
import {
  CurrentStatePanel,
  DecisionJourney,
} from "@/components/proposal/DecisionJourney";
import {
  ConstitutionReference,
  DisputePanel,
} from "@/components/proposal/ContextAndDispute";
import {
  ReviewRecord,
  RevisionHistory,
} from "@/components/proposal/ReviewAndRevision";
import {
  DeterminationPanel,
  VotingPanel,
} from "@/components/proposal/VotingAndDetermination";
import {
  RecordTimeline,
  VerificationPanel,
} from "@/components/proposal/RecordAndVerification";
import { ParticipationPanel } from "@/components/participation/ParticipationPanel";

/**
 * Proposal detail — the Living Decision Record (Experience Blueprint section
 * 10.3).
 *
 * The central product surface. The current stage is visually dominant, the
 * decision journey runs beside the record, and the sections follow the specified
 * content hierarchy: what was proposed, constitutional context, review, revision
 * history, voting, determination, dispute history, verification.
 */
export const dynamic = "force-dynamic";

export default async function ProposalRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    notFound();
  }

  const proposalId = BigInt(id);
  if (proposalId <= 0n) {
    notFound();
  }

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow={`Proposal #${id}`} title="Proposal record" />
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  let record: Awaited<ReturnType<typeof loadProposalRecord>>;
  try {
    record = await loadProposalRecord(proposalId);
  } catch (error) {
    if (isAppError(error) && error.kind === "not_found") {
      notFound();
    }
    throw error;
  }

  const { proposal, config: governance, revisions, events, historyTotal, now } =
    record;
  const stage = deriveProposalStage(proposal, now);
  const preset = resolveNetwork(inspected.config.network);

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow={`Proposal #${proposal.proposalId.toString()}`}
        title={proposal.title}
        lede={undefined}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StateBadge
            label={proposalStageLabel(stage)}
            tone={proposalStageTone(stage)}
          />
          <MetaChip>{proposalTypeLabel(proposal.proposalType)}</MetaChip>
          <MetaChip>
            Proposed by {shortenAddress(proposal.proposer)}
          </MetaChip>
          <MetaChip>Submitted {formatUtcTimestamp(proposal.createdAt)} UTC</MetaChip>
        </div>
      </PageHeader>

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/*
          Experience Blueprint section 15: on mobile the current state and the
          available action come first, and the decision journey — already a
          vertical sequence — follows it. On desktop the journey sits beside the
          record as a sticky column. Order is swapped rather than the layout being
          collapsed into a single stream.
        */}
        <aside className="order-2 lg:order-1 lg:sticky lg:top-8 lg:self-start">
          <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Decision journey
          </h2>
          <div className="mt-5">
            <DecisionJourney proposal={proposal} config={governance} now={now} />
          </div>
        </aside>

        <div className="order-1 space-y-16 lg:order-2">
          <CurrentStatePanel proposal={proposal} config={governance} now={now} />

          <ParticipationPanel proposal={proposal} config={governance} now={now} />

          <section aria-labelledby="proposed-heading" className="space-y-4">
            <SectionHeading
              id="proposed-heading"
              title="What was proposed"
              description="The submitted record, as stored by the contract."
            />
            <div className="space-y-3">
              {proposal.description.trim() === "" ? (
                <p className="text-sm text-ink-muted">No description is recorded.</p>
              ) : (
                <Prose>{proposal.description}</Prose>
              )}
              <p className="text-xs text-ink-subtle">
                Voting length requested by the proposer: recorded with the proposal.
                Current voting branch closes{" "}
                {formatUtcTimestamp(proposal.votingClosesAt)} UTC.
              </p>
            </div>
          </section>

          <ConstitutionReference proposal={proposal} config={governance} />

          <ReviewRecord proposal={proposal} />

          <RevisionHistory proposal={proposal} revisions={revisions} />

          <VotingPanel proposal={proposal} config={governance} now={now} />

          {stage === "voting_open" ? (
            <div>
              <TimingNote
                futureLabel="Voting closes in"
                pastLabel="Voting closed"
                at={proposal.votingClosesAt}
                now={now}
              />
            </div>
          ) : null}

          <DeterminationPanel
            proposal={proposal}
            config={governance}
            now={now}
            events={events}
          />

          <DisputePanel proposal={proposal} config={governance} now={now} />

          <RecordTimeline events={events} historyTotal={historyTotal} />

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

          <p className="text-xs text-ink-subtle">
            <Link href="/explore" className="underline">
              Back to Explore
            </Link>
          </p>

        </div>
      </div>
    </main>
  );
}
