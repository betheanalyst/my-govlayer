import Link from "next/link";
import { inspectRuntimeConfig } from "@/config/env";
import {
  proposalStageLabel,
  proposalStageTone,
  proposalTypeLabel,
} from "@/domain/labels";
import { deriveProposalStage, summarizeProposal } from "@/domain/state";
import type { GovernanceConfig, Proposal } from "@/domain/types";
import { loadExploreSet } from "@/server/reads";
import {
  PageHeader,
  Pagination,
  Panel,
} from "@/components/shared/Primitives";
import { MetaChip, StateBadge } from "@/components/shared/StateBadge";
import {
  ConfigurationIncompleteNotice,
  EmptyState,
  UnverifiedNotice,
} from "@/components/shared/Notices";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/hex";
import { formatUtcTimestamp } from "@/lib/time";

/**
 * Explore (Experience Blueprint section 10.2).
 *
 * Let users observe governance without a wallet. Filtering is honest about its
 * scope: the protocol exposes no filtered queries, so this surface reviews the
 * most recent proposals it loaded and says exactly how many that was.
 *
 * Filter names follow the Blueprint's set. "Under review" is the dispute
 * reevaluation stage, not the initial review -- the initial review completes
 * inside the submission transaction, before a proposal can appear here.
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

const FILTERS = [
  {
    key: "all",
    label: "All",
    description: "Every recorded proposal in the reviewed window.",
  },
  {
    key: "voting",
    label: "Voting",
    description: "Accepted by review, with the voting window currently open.",
  },
  {
    key: "under_review",
    label: "Under review",
    description:
      "Dispute reevaluation in progress after a rejection was challenged.",
  },
  {
    key: "needs_revision",
    label: "Needs revision",
    description: "Review asked for clarification; the proposer may resubmit.",
  },
  {
    key: "disputed",
    label: "Disputed",
    description: "Proposals that have had at least one dispute stage.",
  },
  {
    key: "decided",
    label: "Decided",
    description: "Proposals whose outcome is final: passed, failed, or cancelled.",
  },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function normalizeFilter(value: string | undefined): FilterKey {
  const found = FILTERS.find((filter) => filter.key === value);
  return found?.key ?? "all";
}

function normalizePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function matchesFilter(
  proposal: Proposal,
  config: GovernanceConfig,
  now: number,
  filter: FilterKey,
): boolean {
  const stage = deriveProposalStage(proposal, now);

  switch (filter) {
    case "voting":
      return stage === "voting_open";
    case "under_review":
      return stage === "dispute_reevaluation";
    case "needs_revision":
      return stage === "needs_revision";
    case "disputed":
      return proposal.disputeStage > 0 || stage === "dispute_reevaluation";
    case "decided":
      return stage === "passed" || stage === "failed" || stage === "cancelled";
    default:
      return true;
  }
}

function exploreHref(filter: FilterKey, page: number): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (page > 0) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/explore" : `/explore?${query}`;
}

function ProposalCard({
  proposal,
  config,
  now,
}: {
  proposal: Proposal;
  config: GovernanceConfig;
  now: number;
}) {
  const stage = deriveProposalStage(proposal, now);
  const summary = summarizeProposal(proposal, config, now);

  return (
    <li>
      <Panel className="transition-colors duration-state hover:border-line-control">
        <div className="flex flex-wrap items-center gap-3">
          <StateBadge
            label={proposalStageLabel(stage)}
            tone={proposalStageTone(stage)}
          />
          <MetaChip>{proposalTypeLabel(proposal.proposalType)}</MetaChip>
          <MetaChip>#{proposal.proposalId.toString()}</MetaChip>
        </div>

        <h2 className="mt-3 text-lg">
          <Link href={`/proposals/${proposal.proposalId.toString()}`} className="hover:underline">
            {proposal.title}
          </Link>
        </h2>

        <p className="mt-2 line-clamp-2 max-w-prose text-sm text-ink-muted">
          {proposal.description}
        </p>

        <p className="mt-3 text-sm text-ink-muted">{summary.nextStep}</p>

        {/*
          Experience Blueprint section 10.2: proposal items should carry
          relevant timing. The only deadline that is meaningful while a proposal
          is still open to votes is the recorded voting deadline; after it
          passes, the state itself says what is outstanding.
        */}
        {stage === "voting_open" ? (
          <p className="mt-2 text-xs text-ink-subtle">
            Voting closes {formatUtcTimestamp(proposal.votingClosesAt)} UTC
          </p>
        ) : null}

        <p className="mt-3 text-xs text-ink-subtle">
          Proposed by {shortenAddress(proposal.proposer)} ·{" "}
          {formatUtcTimestamp(proposal.createdAt)} UTC
        </p>
      </Panel>
    </li>
  );
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const params = await searchParams;
  const filter = normalizeFilter(params.filter);
  const page = normalizePage(params.page);
  const filterDefinition = FILTERS.find((entry) => entry.key === filter);

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="Explore"
          title="Governance record"
          lede="Observe governance without connecting a wallet."
        />
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  let set: Awaited<ReturnType<typeof loadExploreSet>> | undefined;
  let failure: unknown;

  try {
    set = await loadExploreSet();
  } catch (error) {
    failure = error;
  }

  if (failure !== undefined || set === undefined) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="Explore"
          title="Governance record"
          lede="Observe governance without connecting a wallet."
        />
        <div className="mt-8">
          <UnverifiedNotice
            subject="The governance record"
            error={failure ?? new Error("No records were returned")}
          />
        </div>
      </main>
    );
  }

  const filtered = set.proposals.filter((proposal) =>
    matchesFilter(proposal, set.config, set.now, filter),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Explore"
        title="Governance record"
        lede="Every proposal, its constitutional review, its participation, and its outcome — readable without a wallet."
      />

      {set.paused ? (
        <div className="mt-6">
          <Panel tone="sunken">
            <p className="text-sm text-ink">
              New proposal submission is currently paused.
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Voting, disputing, finalizing, resubmitting, and cancelling are
              unaffected. Existing proposals continue their journey.
            </p>
          </Panel>
        </div>
      ) : null}

      <nav aria-label="Filter proposals" className="mt-8">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((entry) => {
            const isActive = entry.key === filter;
            return (
              <li key={entry.key}>
                <Link
                  href={exploreHref(entry.key, 0)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "inline-block rounded-full border px-3 py-1.5 text-sm",
                    isActive
                      ? "border-ink bg-ink text-ink-inverse"
                      : "border-line bg-surface-raised text-ink-muted hover:border-line-control hover:text-ink",
                  )}
                >
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {filterDefinition === undefined ? null : (
          <p className="mt-3 text-sm text-ink-muted">{filterDefinition.description}</p>
        )}
      </nav>

      <p className="mt-6 text-xs text-ink-subtle">
        Scope: reviewing the most recent {set.scanned} of {set.total} recorded
        proposals. The contract exposes proposals as one chronological sequence, so
        filters apply within this window.
      </p>

      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={
              set.total === 0
                ? "No proposals have been recorded yet"
                : "Nothing matches this filter"
            }
            description={
              set.total === 0
                ? "Once a proposal is submitted it appears here immediately, together with its constitutional review."
                : `No proposal in the reviewed window (${set.scanned} most recent of ${set.total}) matches "${filterDefinition?.label ?? filter}". Older proposals are outside this window.`
            }
            action={
              set.total === 0 ? (
                <Link href="/how-it-works" className="underline">
                  See how a proposal is created
                </Link>
              ) : (
                <Link href={exploreHref("all", 0)} className="underline">
                  Clear the filter
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {visible.map((proposal) => (
            <ProposalCard
              key={proposal.proposalId.toString()}
              proposal={proposal}
              config={set.config}
              now={set.now}
            />
          ))}
        </ul>
      )}

      <Pagination
        page={safePage}
        pageCount={pageCount}
        hrefForPage={(target) => exploreHref(filter, target)}
        label="Proposal pages"
      />
    </main>
  );
}

