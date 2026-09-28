import Link from "next/link";
import { formatInteger } from "@/lib/format";
import {
  disputeCooldownRemaining,
  disputeStagesRemaining,
} from "@/domain/state";
import type { GovernanceConfig, Proposal } from "@/domain/types";
import {
  Panel,
  Prose,
  SectionHeading,
  TimingNote,
} from "@/components/shared/Primitives";
import { formatDuration, formatUtcTimestamp } from "@/lib/time";
import { shortenAddress } from "@/lib/hex";

/**
 * Constitutional context (Experience Blueprint section 10.4).
 *
 * The snapshot relationship is made explicit: review, revision, and dispute all
 * evaluate against the text captured when the proposal was submitted, never
 * against a constitution that may have moved on since.
 */
export function ConstitutionReference({
  proposal,
  config,
}: {
  proposal: Proposal;
  config: GovernanceConfig;
}) {
  return (
    <section aria-labelledby="constitution-heading" className="space-y-4">
      <SectionHeading
        id="constitution-heading"
        title="Constitutional context"
        description="The text this proposal was measured against. It was captured when the proposal was submitted and does not move with later amendments."
      />

      <Panel tone="sunken">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            Constitution snapshot — captured at submission
          </p>
          <p className="text-xs text-ink-subtle">
            The DAO constitution is currently at version{" "}
            {formatInteger(config.constitutionVersion)}
          </p>
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          A proposal records the constitution text it was evaluated against. The
          version number of that snapshot is not recorded per proposal, so it is not
          claimed here.
        </p>
        <div className="mt-4">
          {proposal.constitutionSnapshot.trim() === "" ? (
            <p className="text-sm text-ink-muted">No snapshot text is recorded.</p>
          ) : (
            <Prose className="max-h-80 overflow-y-auto">
              {proposal.constitutionSnapshot}
            </Prose>
          )}
        </div>
        <p className="mt-4 text-xs text-ink-subtle">
          <Link href="/constitution" className="underline">
            Read the current constitution
          </Link>
        </p>
      </Panel>

      {proposal.proposalType === "constitution" ? (
        <Panel>
          <p className="text-sm font-medium text-ink">Proposed amendment</p>
          <p className="mt-1 text-xs text-ink-subtle">
            The submitted text, recorded exactly as proposed.
          </p>
          <div className="mt-4">
            <Prose className="max-h-80 overflow-y-auto">
              {proposal.proposedConstitution}
            </Prose>
          </div>
        </Panel>
      ) : null}
    </section>
  );
}
export function DisputePanel({
  proposal,
  config,
  now,
}: {
  proposal: Proposal;
  config: GovernanceConfig;
  now: number;
}) {
  const stagesRemaining = disputeStagesRemaining(proposal, config);
  const cooldown = disputeCooldownRemaining(proposal, config, now);
  const isRejected = proposal.status === "rejected";

  return (
    <section aria-labelledby="dispute-heading" className="space-y-6">
      <SectionHeading
        id="dispute-heading"
        title="Dispute"
        description="A dispute is a narrow constitutional reevaluation, not a general appeal."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel tone="sunken">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
            What stays the same
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            The original proposal, its recorded review, and its constitutional
            snapshot. The proposal is reevaluated, not replaced.
          </p>
        </Panel>
        <Panel tone="sunken">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
            What changes
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            A fresh constitutional reevaluation, which can overturn the review
            outcome.
          </p>
        </Panel>
        <Panel tone="sunken">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
            What does not happen
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            A dispute neither approves the proposal nor finalizes governance. If a
            rejection is overturned, a real voting window opens.
          </p>
        </Panel>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">Dispute stages used</dt>
          <dd className="text-ink">
            {proposal.disputeStage} of {formatInteger(config.maxDisputeStagesCount)}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">Stages remaining</dt>
          <dd className="text-ink">{stagesRemaining}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">Who may raise a dispute</dt>
          <dd className="text-ink">
            {isRejected
              ? "The proposer, or an address that recorded a vote on this proposal"
              : "Only a proposal rejected in constitutional review can be disputed"}
          </dd>
        </div>
      </dl>

      {cooldown === null ? null : (
        <TimingNote
          futureLabel="The next dispute stage becomes available in"
          pastLabel="The next dispute stage became available"
          at={now + cooldown}
          now={now}
        />
      )}

      {proposal.disputeHistory.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No dispute has been raised on this proposal.
        </p>
      ) : (
        <ol className="space-y-4">
          {[...proposal.disputeHistory].reverse().map((dispute) => (
            <li key={dispute.stage}>
              <Panel tone="sunken">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-ink">
                    Stage {dispute.stage} —{" "}
                    {dispute.resolution === "accept"
                      ? "rejection overturned, voting reopened"
                      : dispute.resolution === "reject"
                        ? "rejection upheld"
                        : `recorded outcome: ${dispute.resolution}`}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    raised by {shortenAddress(dispute.raisedBy)} ·{" "}
                    {formatUtcTimestamp(dispute.raisedAt)} UTC
                  </p>
                </div>
                {dispute.reasoning.trim() === "" ? null : (
                  <div className="mt-3">
                    <Prose>{dispute.reasoning}</Prose>
                  </div>
                )}
              </Panel>
            </li>
          ))}
        </ol>
      )}

      {isRejected ? null : (
        <p className="text-xs text-ink-subtle">
          A post-vote failure is a governance outcome rather than an AI judgment, so
          the contract does not allow it to be disputed.
        </p>
      )}

      <p className="text-xs text-ink-subtle">
        The contract enforces a {formatDuration(config.disputeCooldownSeconds)}{" "}
        cooldown between stages and allows at most{" "}
        {formatInteger(config.maxDisputeStagesCount)} stages per proposal.
      </p>
    </section>
  );
}

