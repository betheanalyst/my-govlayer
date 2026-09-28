import { formatInteger } from "@/lib/format";
import {
  approvalPercentText,
  approvalStatus,
  describeFailureReason,
  deriveProposalStage,
  quorumStatus,
  voteTallies,
} from "@/domain/state";
import {
  eligibilityModeLabel,
  voteUnitLabel,
  votingWeightModeLabel,
} from "@/domain/labels";
import type {
  GovernanceConfig,
  GovernanceEvent,
  Proposal,
} from "@/domain/types";
import {
  Panel,
  RecordedText,
  SectionHeading,
  TimingNote,
} from "@/components/shared/Primitives";
import { formatUtcTimestamp } from "@/lib/time";

/**
 * Voting and determination surfaces (Experience Blueprint sections 10.9, 10.10).
 *
 * Read-only in this phase: the proposal's recorded participation and the exact
 * progress numbers are shown, and the immutability of votes is stated. Casting a
 * vote arrives with wallet participation in a later phase.
 *
 * Honest scope: GovLayerCore records tallies but exposes no per-voter data, so no
 * participant list is shown and none is implied.
 */

function ProgressBar({ value, max }: { value: bigint; max: bigint }) {
  const capped = value > max ? max : value;
  // A bounded ratio (0-100), not a protocol amount, so Number is safe here.
  const percent = max === 0n ? 0 : Number((capped * 100n) / max);

  return (
    <div
      role="presentation"
      className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
    >
      <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function VotingPanel({
  proposal,
  config,
  now,
}: {
  proposal: Proposal;
  config: GovernanceConfig;
  now: number;
}) {
  const tallies = voteTallies(proposal, config);
  const quorum = quorumStatus(proposal, config);
  const approval = approvalStatus(proposal, config);
  const unit = voteUnitLabel(tallies.weighted);
  const stage = deriveProposalStage(proposal, now);

  return (
    <section aria-labelledby="voting-heading" className="space-y-6">
      <SectionHeading
        id="voting-heading"
        title="Voting"
        description="Voting decides the governance outcome. It happens only after constitutional review accepts a proposal."
      />

      <Panel>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
              Recorded yes
            </p>
            <p className="mt-1 font-display text-2xl text-ink">
              {formatInteger(tallies.yes)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">
              Recorded no
            </p>
            <p className="mt-1 font-display text-2xl text-ink">
              {formatInteger(tallies.no)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-ink-subtle">
          Measured in {unit}
          {tallies.weighted ? ", because this DAO counts voting weight" : ""}.
        </p>

        <dl className="mt-6 space-y-5 border-t border-line pt-5 text-sm">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-ink-muted">
                Quorum — {formatInteger(quorum.required)} {unit} required
              </dt>
              <dd className="text-ink">
                {quorum.met ? "Met" : "Not met"} ({formatInteger(quorum.recorded)}{" "}
                {unit} recorded)
              </dd>
            </div>
            <ProgressBar value={quorum.recorded} max={quorum.required} />
          </div>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-ink-muted">
                Approval — {formatInteger(approval.thresholdPercent)}% required
              </dt>
              <dd className="text-ink">
                {approval.approvalPercent === null
                  ? "No votes recorded yet"
                  : `${formatInteger(approval.approvalPercent)}% recorded`}
              </dd>
            </div>
            <ProgressBar
              value={approval.approvalPercent ?? 0n}
              max={approval.thresholdPercent}
            />
            {approvalPercentText(approval) === null ? null : (
              <p className="mt-2 text-xs text-ink-subtle">
                Rounded for display: {approvalPercentText(approval)}. The figure
                above is the exact value the contract records.
              </p>
            )}
          </div>
        </dl>

        {stage === "voting_open" || stage === "voting_closed_awaiting_finalization" ? (
          <div className="mt-6 border-t border-line pt-5">
            <TimingNote
              futureLabel="Voting closes in"
              pastLabel="Voting closed"
              at={proposal.votingClosesAt}
              now={now}
            />
          </div>
        ) : null}
      </Panel>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Participation rules</h3>
        <ul className="space-y-1 text-sm text-ink-muted">
          <li>Eligibility: {eligibilityModeLabel(config.eligibilityMode)}</li>
          <li>Weighting: {votingWeightModeLabel(config.votingWeightMode)}</li>
          {config.useWhitelistForVoting ? (
            <li>The voter whitelist is active; an address must also be whitelisted.</li>
          ) : null}
          {config.minTokensToVote > 0n ? (
            <li>
              At least {formatInteger(config.minTokensToVote)} tokens are required to
              vote.
            </li>
          ) : null}
        </ul>
      </div>

      <p className="text-sm text-ink-muted">
        A vote is immutable once recorded: it cannot be changed, withdrawn, or
        recast. The protocol records the tally, not individual votes, so no list of
        who voted is shown here.
      </p>
    </section>
  );
}
/**
 * Determination (Experience Blueprint section 10.10).
 *
 * Finalization creates closure. A governance failure is described as a failed
 * vote against the configured requirements -- never as a rejection -- and the
 * recorded determination entry is shown alongside it.
 */
export function DeterminationPanel({
  proposal,
  config,
  now,
  events,
}: {
  proposal: Proposal;
  config: GovernanceConfig;
  now: number;
  events: readonly GovernanceEvent[];
}) {
  const stage = deriveProposalStage(proposal, now);
  const tallies = voteTallies(proposal, config);
  const quorum = quorumStatus(proposal, config);
  const approval = approvalStatus(proposal, config);
  const unit = voteUnitLabel(tallies.weighted);

  const determination = events.find(
    (event) =>
      event.eventType === "proposal_passed" ||
      event.eventType === "proposal_failed" ||
      event.eventType === "constitution_update_pending_confirm" ||
      event.eventType === "constitution_update_applied",
  );

  const failureReason = describeFailureReason(proposal.failureReason);

  return (
    <section aria-labelledby="determination-heading" className="space-y-6">
      <SectionHeading
        id="determination-heading"
        title="Determination"
        description="Determination records what eligible participants decided, measured against the configured quorum and approval threshold."
      />

      <Panel>
        {stage === "passed" ? (
          <>
            <h3 className="text-lg text-ink">Passed</h3>
            <p className="mt-2 max-w-prose text-sm text-ink-muted">
              This proposal met the configured quorum and approval threshold. The
              outcome is final and recorded.
            </p>
          </>
        ) : null}

        {stage === "failed" ? (
          <>
            <h3 className="text-lg text-ink">Failed</h3>
            <p className="mt-2 max-w-prose text-sm text-ink-muted">
              {failureReason === null ? "The" : `${failureReason} — the`} proposal did
              not meet the configured governance requirements after voting closed.
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              A failed vote is a governance outcome, not a constitutional-review
              outcome, and it cannot be disputed.
            </p>
          </>
        ) : null}

        {stage === "awaiting_stewardship_confirmation" ? (
          <>
            <h3 className="text-lg text-ink">
              Vote accepted — awaiting stewardship confirmation
            </h3>
            <p className="mt-2 max-w-prose text-sm text-ink-muted">
              The vote accepted this constitution amendment. Applying it requires
              an authorized stewardship action, and GovLayerCore independently
              validates that authorization before the constitution changes.
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              Until then the constitution is unchanged and this proposal is not yet
              fully applied.
            </p>
          </>
        ) : null}

        {stage === "cancelled" ? (
          <>
            <h3 className="text-lg text-ink">Cancelled before determination</h3>
            <p className="mt-2 max-w-prose text-sm text-ink-muted">
              The proposer cancelled this proposal before its voting window closed,
              so no determination was reached.
            </p>
          </>
        ) : null}

        {stage === "voting_open" ||
        stage === "voting_closed_awaiting_finalization" ||
        stage === "review_rejected" ||
        stage === "needs_revision" ||
        stage === "dispute_reevaluation" ||
        stage === "unrecognized" ? (
          <>
            <h3 className="text-lg text-ink">No determination yet</h3>
            <p className="mt-2 max-w-prose text-sm text-ink-muted">
              The outcome is recorded once the voting window has closed and someone
              finalizes the decision.
            </p>
          </>
        ) : null}

        <dl className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Quorum</dt>
            <dd className="text-ink">
              {quorum.met ? "Met" : "Not met"} — {formatInteger(quorum.recorded)} of{" "}
              {formatInteger(quorum.required)} {unit}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Approval threshold</dt>
            <dd className="text-ink">
              {approval.approvalPercent === null
                ? "None recorded"
                : `${formatInteger(approval.approvalPercent)}% of ${formatInteger(
                    approval.thresholdPercent,
                  )}% required`}
            </dd>
          </div>
        </dl>
      </Panel>

      {determination === undefined ? (
        <p className="text-sm text-ink-muted">
          No determination entry is present in the scanned portion of the
          governance history.
        </p>
      ) : (
        <div>
          <h3 className="text-sm font-medium text-ink">Determination record</h3>
          <p className="mt-1 text-xs text-ink-subtle">
            {formatUtcTimestamp(determination.timestamp)} UTC · recorded as{" "}
            <span className="font-mono">{determination.eventType}</span>
          </p>
          <div className="mt-3">
            <RecordedText value={determination.details} />
          </div>
        </div>
      )}
    </section>
  );
}

