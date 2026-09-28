"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatInteger } from "@/lib/format";
import { formatUtcTimestamp } from "@/lib/time";
import { cn } from "@/lib/cn";
import { isVotingOpen, voteTallies } from "@/domain/state";
import type { GovernanceConfig, Proposal } from "@/domain/types";
import { useEligibility } from "@/queries/eligibilityQueries";
import { useVote } from "@/queries/writeHooks";
import { useWallet } from "@/wallet/WalletProvider";
import { StateBadge } from "@/components/shared/StateBadge";
import { Panel } from "@/components/shared/Primitives";
import { WriteResultPanel } from "./WriteResultPanel";

/**
 * Voting (Experience Blueprint section 10.9).
 *
 * The proposal, its review outcome, its constitution context and its deadline
 * are already stated on the record above this panel, so this control adds only
 * what is specific to casting a vote: eligibility, voting weight, the current
 * tally, and confirmation.
 *
 * Immutability is stated before confirmation, never after, and the interface
 * never implies a vote can be changed, withdrawn, or recast. Whether this
 * address has already voted cannot be read from the protocol, so the contract's
 * own refusal is what answers that question.
 */
export function VotePanel({
  proposal,
  config,
  now,
}: {
  readonly proposal: Proposal;
  readonly config: GovernanceConfig;
  readonly now: number;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const eligibility = useEligibility("vote");
  const vote = useVote();
  const [choice, setChoice] = useState<boolean | null>(null);

  const tallies = voteTallies(proposal, config);
  const open = isVotingOpen(proposal, now);

  async function submit(support: boolean) {
    try {
      await vote.mutateAsync({ proposalId: proposal.proposalId, support });
      setChoice(null);
      router.refresh();
    } catch {
      // The mutation's error state renders below; nothing is swallowed.
    }
  }

  return (
    <section aria-labelledby="vote-heading" className="space-y-4">
      <h2
        id="vote-heading"
        className="text-xs uppercase tracking-[0.18em] text-ink-subtle"
      >
        Your vote
      </h2>

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <StateBadge
            label={open ? "Voting open" : "Voting closed"}
            tone={open ? "info" : "neutral"}
          />
          <span className="text-xs text-ink-subtle">
            Closes {formatUtcTimestamp(proposal.votingClosesAt)} UTC
          </span>
        </div>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-subtle">Recorded tallies:</dt>
            <dd className="text-ink">
              {formatInteger(tallies.yes)} yes · {formatInteger(tallies.no)} no
              {tallies.weighted ? " (voting weight)" : ""}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-subtle">Your weight if you vote:</dt>
            <dd className="text-ink">
              {config.votingWeightMode === "token_weighted"
                ? "Your token balance at the moment of voting."
                : "One vote."}
            </dd>
          </div>
        </dl>

        {eligibility.result === null ? (
          <p className="mt-4 max-w-prose text-sm text-ink-muted">
            {wallet.address === null
              ? "Eligibility is evaluated against a connected address. Connect a wallet to see what this DAO requires."
              : "Reading this DAO's participation requirements…"}
          </p>
        ) : (
          <div className="mt-4">
            <p className="max-w-prose text-sm text-ink">
              {eligibility.result.summary}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-ink-subtle">
              {eligibility.result.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
              {eligibility.result.unreadRequirements.map((requirement) => (
                <li key={requirement}>Could not be read: {requirement}</li>
              ))}
            </ul>
          </div>
        )}
        {open ? (
          <div className="mt-5">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setChoice(true)}
                disabled={vote.isPending}
                className={cn(
                  "rounded-card border px-5 py-2.5 text-sm transition-colors duration-state",
                  choice === true
                    ? "border-accent bg-accent text-ink-inverse"
                    : "border-line-control text-ink hover:border-ink-muted",
                )}
              >
                Vote yes
              </button>
              <button
                type="button"
                onClick={() => setChoice(false)}
                disabled={vote.isPending}
                className={cn(
                  "rounded-card border px-5 py-2.5 text-sm transition-colors duration-state",
                  choice === false
                    ? "border-accent bg-accent text-ink-inverse"
                    : "border-line-control text-ink hover:border-ink-muted",
                )}
              >
                Vote no
              </button>
            </div>

            {choice === null ? null : (
              <div className="mt-4 rounded-card border border-line bg-surface-sunken p-5">
                <p className="text-sm font-medium text-ink">
                  Votes are immutable once recorded.
                </p>
                <p className="mt-2 max-w-prose text-sm text-ink-muted">
                  A vote cannot be changed, withdrawn, or recast. The contract
                  records one vote per address and keeps the tally rather than the
                  voter, so this interface cannot show which way an address voted.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void submit(choice)}
                    disabled={
                      vote.isPending || wallet.writeBlockedReason !== null
                    }
                    className="rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {vote.isPending
                      ? "Waiting for the network…"
                      : `Confirm vote ${choice ? "yes" : "no"}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChoice(null)}
                    disabled={vote.isPending}
                    className="rounded-card border border-line-control px-5 py-2.5 text-sm text-ink hover:border-ink-muted"
                  >
                    Cancel
                  </button>
                </div>
                {wallet.writeBlockedReason === null ? null : (
                  <p className="mt-3 max-w-prose text-xs text-ink-subtle">
                    {wallet.writeBlockedReason}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-5 max-w-prose text-sm text-ink-muted">
            Voting is not open for this proposal, so there is nothing to do here.
          </p>
        )}

        <div className="mt-5">
          <WriteResultPanel
            pending={vote.isPending}
            report={vote.data ?? null}
            error={vote.error ?? null}
          />
        </div>
      </Panel>
    </section>
  );
}
