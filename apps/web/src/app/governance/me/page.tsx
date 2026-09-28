"use client";

import Link from "next/link";
import { useState } from "react";
import {
  deriveProposalStage,
  disputeStagesRemaining,
  isProposer,
} from "@/domain/state";
import { proposalStageLabel, proposalStageTone } from "@/domain/labels";
import { formatUtcTimestamp } from "@/lib/time";
import { useGovernanceConfig, useProposalPage } from "@/queries/coreQueries";
import { useWallet } from "@/wallet/WalletProvider";
import { WalletRequirementNotice } from "@/wallet/ConnectWallet";
import { inspectRuntimeConfig } from "@/config/env";
import {
  ConfigurationIncompleteNotice,
} from "@/components/shared/Notices";
import { PageHeader, Panel } from "@/components/shared/Primitives";
import { StateBadge } from "@/components/shared/StateBadge";
import type { Proposal } from "@/domain/types";

/**
 * My governance (Experience Blueprint section 10.14).
 *
 * A connected-user command center answering one question: what requires my
 * attention? Deliberately not a generic wallet dashboard.
 *
 * Two limits are stated rather than papered over:
 *
 *  - the protocol exposes one chronological proposal sequence and no filtered
 *    queries, so this surface reviews a bounded window and says how large it was;
 *  - GovLayerCore records the tally, not the voter, so "proposals I voted on"
 *    cannot be listed. That group is not invented here.
 */

const PAGE_SIZE = 25;

export default function MyGovernancePage() {
  const wallet = useWallet();

  /**
   * The window is walked with local view state rather than URL parameters. This
   * is a connected-user surface, so it has no shareable public state, and keeping
   * it out of the query string means the whole page renders without waiting for a
   * search-params boundary.
   */
  const [page, setPage] = useState(0);

  const config = useGovernanceConfig();
  const proposals = useProposalPage(page, PAGE_SIZE);

  /**
   * A deployment whose contract addresses are not configured is reported as
   * exactly that, with the missing variables named, rather than as a read
   * failure or a wallet problem.
   */
  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="My governance"
          title="What requires your attention"
        />
        <div className="mt-10">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  if (wallet.address === null) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="My governance"
          title="What requires your attention"
          lede="This surface is built around a connected address: the proposals you submitted, the ones you can still act on, and the disputes available to you."
        />
        <div className="mt-10">
          <WalletRequirementNotice action="see your own governance position" />
        </div>
        <p className="mt-6 text-sm">
          <Link href="/explore" className="underline">
            Explore governance without a wallet
          </Link>
        </p>
      </main>
    );
  }

  const address = wallet.address;

  if (proposals.isError) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="My governance" title="What requires your attention" />
        <p className="mt-8 max-w-prose text-sm text-ink-muted">
          The governance record could not be verified right now. This is not a
          statement about your position. Retry in a moment.
        </p>
      </main>
    );
  }

  if (proposals.data === undefined || config.data === undefined) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="My governance" title="What requires your attention" />
        <p className="mt-8 text-sm text-ink-muted">Reading the governance record…</p>
      </main>
    );
  }

  const governance = config.data;
  const set = proposals.data;
  const now = Math.floor(Date.now() / 1000);
  const pageCount = Math.max(1, Math.ceil(set.total / PAGE_SIZE));

  const mine = set.proposals.filter((proposal) => isProposer(proposal, address));
  const needsRevision = mine.filter((p) => p.status === "needs_revision");
  const disputes = mine.filter(
    (p) => p.status === "rejected" && disputeStagesRemaining(p, governance) > 0,
  );
  const awaitingFinalization = set.proposals.filter(
    (p) => deriveProposalStage(p, now) === "voting_closed_awaiting_finalization",
  );
  const openForVoting = set.proposals.filter(
    (p) => deriveProposalStage(p, now) === "voting_open",
  );
  const decided = set.proposals.filter((p) =>
    ["passed", "failed", "pending_constitution_confirm"].includes(p.status),
  );

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="My governance"
        title="What requires your attention"
        lede="Actions you can take, drawn from the most recent proposals the contract returns. A proposal outside this window is still on the record itself."
      />

      <p className="mt-6 max-w-prose text-xs text-ink-subtle">
        Reviewing the most recent {set.proposals.length} of {set.total} recorded
        proposals. The contract exposes proposals as one chronological sequence with
        no filtered queries, so this is a window rather than the whole history.
      </p>

      <div className="mt-10 space-y-12">
        <Group
          title="Needs your action"
          description="Proposals you submitted that the review asked you to revise."
          items={needsRevision}
          now={now}
          emptyText="No proposal of yours needs revision."
        />

        <Group
          title="Disputes available to you"
          description="Proposals you submitted that review rejected, with dispute stages remaining."
          items={disputes}
          now={now}
          emptyText="No rejected proposal of yours has dispute stages remaining."
        />

        <Group
          title="Awaiting finalization"
          description="Voting has closed. Finalization is permissionless, so anyone may record the determination."
          items={awaitingFinalization}
          now={now}
          emptyText="No proposal in this window is waiting to be finalized."
        />

        <Group
          title="Open for voting"
          description="Whether your address is eligible is evaluated on the proposal itself, against this DAO's configuration."
          items={openForVoting}
          now={now}
          emptyText="No proposal in this window is open for voting."
        />

        <Group
          title="Your proposals"
          description="Proposals this address submitted, as recorded by the contract."
          items={mine}
          now={now}
          emptyText="This address has not submitted a proposal in this window."
        />

        <Group
          title="Recently decided"
          description="Determinations recorded in this window, whether or not they are yours."
          items={decided}
          now={now}
          emptyText="No determination has been recorded in this window."
        />

        <Panel tone="sunken">
          <p className="text-sm font-medium text-ink">
            What this surface cannot show
          </p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            GovLayerCore records the vote tally rather than the voter, so there is no
            way to list the proposals an address voted on, or to show which way it
            voted. That group is absent because the protocol does not expose it — not
            because it is empty.
          </p>
        </Panel>
      </div>

      <nav aria-label="Governance window pages" className="mt-10 flex items-center gap-4 text-sm">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          disabled={page === 0}
          className="rounded-card border border-line-control px-4 py-2 text-ink transition-colors duration-state hover:border-ink-muted disabled:cursor-not-allowed disabled:border-line disabled:text-ink-subtle"
        >
          Newer proposals
        </button>
        <span className="text-xs text-ink-subtle">
          Window {page + 1} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          disabled={page >= pageCount - 1}
          className="rounded-card border border-line-control px-4 py-2 text-ink transition-colors duration-state hover:border-ink-muted disabled:cursor-not-allowed disabled:border-line disabled:text-ink-subtle"
        >
          Older proposals
        </button>
      </nav>
    </main>
  );
}

function Group({
  title,
  description,
  items,
  now,
  emptyText,
}: {
  readonly title: string;
  readonly description: string;
  readonly items: readonly Proposal[];
  readonly now: number;
  readonly emptyText: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">{title}</h2>
      <p className="mt-2 max-w-prose text-xs text-ink-subtle">{description}</p>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((proposal) => {
            const stage = deriveProposalStage(proposal, now);

            return (
              <li
                key={proposal.proposalId.toString()}
                className="rounded-card border border-line bg-surface-raised p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <StateBadge
                    label={proposalStageLabel(stage)}
                    tone={proposalStageTone(stage)}
                  />
                  <span className="text-xs text-ink-subtle">
                    #{proposal.proposalId.toString()}
                  </span>
                </div>
                <p className="mt-3 text-lg">
                  <Link
                    href={`/proposals/${proposal.proposalId.toString()}`}
                    className="hover:underline"
                  >
                    {proposal.title}
                  </Link>
                </p>
                <p className="mt-2 text-xs text-ink-subtle">
                  Submitted {formatUtcTimestamp(proposal.createdAt)} UTC · closes{" "}
                  {formatUtcTimestamp(proposal.votingClosesAt)} UTC
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
