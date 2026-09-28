import Link from "next/link";
import { inspectRuntimeConfig } from "@/config/env";
import { resolveNetwork } from "@/config/network";
import {
  eligibilityModeLabel,
  votingWeightModeLabel,
} from "@/domain/labels";
import { formatInteger } from "@/lib/format";
import { loadStewardshipSummary } from "@/server/reads";
import {
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

/**
 * Home (Experience Blueprint sections 10.1 and 23).
 *
 * A welcome and definition experience first: what GovLayer is, why it exists, how
 * it works, where GenLayer comes in, then where to go next. Deliberately no
 * proposal grid and no wallet prompt above the fold.
 */
export const dynamic = "force-dynamic";

const LIFECYCLE = [
  { label: "Rule", detail: "The constitution defines what is allowed." },
  { label: "Proposal", detail: "A proposal is submitted and recorded." },
  {
    label: "Constitutional review",
    detail: "Compliance is assessed before anything is voted on.",
  },
  { label: "Voting", detail: "Eligible participants decide the outcome." },
  { label: "Record", detail: "The whole journey stays inspectable." },
] as const;

export default async function HomePage() {
  const inspected = inspectRuntimeConfig();

  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <h1 className="text-3xl sm:text-4xl">GovLayer</h1>
        <p className="mt-4 max-w-prose text-ink-muted">
          A governance system in which a proposal must first demonstrate
          constitutional compliance before the community decides whether it should
          pass.
        </p>
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  const config = inspected.config;
  const preset = resolveNetwork(config.network);

  let summary: Awaited<ReturnType<typeof loadStewardshipSummary>> | undefined;
  let failure: unknown;

  try {
    summary = await loadStewardshipSummary();
  } catch (error) {
    failure = error;
  }

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <section aria-labelledby="hero-heading" className="max-w-prose">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Constitutional governance, enforced by design
        </p>
        <h1 id="hero-heading" className="mt-4 text-4xl leading-tight sm:text-5xl">
          A proposal proves it complies before anyone votes on it.
        </h1>
        <p className="mt-6 text-lg text-ink-muted">
          GovLayer is a governance system in which a proposal must first
          demonstrate constitutional compliance before the community decides
          whether it should pass. Rules, review, participation, and outcomes form
          one inspectable record.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/explore"
            className="rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong"
          >
            Explore governance
          </Link>
          <Link
            href="/how-it-works"
            className="rounded-card border border-line-control px-5 py-2.5 text-sm text-ink hover:border-ink-muted"
          >
            How it works
          </Link>
        </div>
      </section>

      <section aria-labelledby="lifecycle-heading" className="mt-16">
        <h2 id="lifecycle-heading" className="sr-only">
          The governance lifecycle
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-5">
          {LIFECYCLE.map((step) => (
            <li key={step.label} className="bg-surface-raised p-5">
              <p className="font-display text-sm text-ink">{step.label}</p>
              <p className="mt-2 text-xs text-ink-muted">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="why-heading" className="mt-20 max-w-prose">
        <SectionHeading
          id="why-heading"
          title="Why GovLayer exists"
          description="A vote answers whether the community wants something. It does not, by itself, answer whether the proposal was allowed in the first place."
        />
        <div className="mt-6 space-y-4 text-[0.9375rem] leading-relaxed text-ink-muted">
          <p>
            Governance systems usually decide first and discover conflicts later.
            By then the decision carries a legitimacy the rules never established,
            and the argument becomes whether an outcome should be honoured anyway.
          </p>
          <p>
            GovLayer asks that question first. A proposal is measured against the
            constitution before it can be voted on. If it conflicts, the record
            says so — and the proposer can revise it, or dispute the assessment
            within strict limits.
          </p>
          <p>
            Because review comes first, a rejection for non-compliance is never
            mistaken for a community deciding against an idea, and a failed vote is
            never mistaken for a constitutional judgment. They are different
            outcomes, and the interface records them differently.
          </p>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="mt-20">
        <SectionHeading
          id="how-heading"
          title="How it works"
          description="Four decisions, in order, each recorded as it happens."
        />
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-ink">1. Constitutional review</p>
            <p className="mt-2 text-sm text-ink-muted">
              A proposal is assessed against the constitution. Review produces
              accepted, needs revision, or rejected — an answer about compliance,
              not about popularity.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">2. Revision or dispute</p>
            <p className="mt-2 text-sm text-ink-muted">
              A proposal that needs revision can be improved and reviewed again. A
              proposal rejected in review can be disputed — a narrow reevaluation
              that never approves a proposal by itself.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">3. Voting</p>
            <p className="mt-2 text-sm text-ink-muted">
              Only proposals that passed review are voted on. Votes are immutable,
              and the outcome depends on the configured quorum and approval
              threshold.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">4. Determination</p>
            <p className="mt-2 text-sm text-ink-muted">
              A vote produces passed or failed. A constitutional amendment that
              passes still requires an authorized confirmation before the
              constitution actually changes.
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          <Link href="/how-it-works" className="underline">
            Read the full explanation
          </Link>
        </p>
      </section>
      <section aria-labelledby="genlayer-heading" className="mt-20 max-w-prose">
        <SectionHeading
          id="genlayer-heading"
          title="Where GenLayer comes in"
          description="Constitutional review is a judgment about language, and judgments need agreement."
        />
        <div className="mt-6 space-y-4 text-[0.9375rem] leading-relaxed text-ink-muted">
          <p>
            Deciding whether a proposal conflicts with a written constitution
            cannot be reduced to arithmetic. It requires reading the proposal and
            the rules together and reaching a conclusion.
          </p>
          <p>
            GenLayer provides that conclusion without a trusted operator: the
            review is evaluated independently by more than one participant, and the
            contract records an outcome only when those evaluations agree. What
            the protocol acts on is the decision itself, recorded on chain.
          </p>
          <p>
            Review is not authority. It decides compliance; the community decides
            direction. GenLayer makes the first answer verifiable while the second
            remains a vote.
          </p>
        </div>
      </section>

      <section aria-labelledby="state-heading" className="mt-20">
        <SectionHeading
          id="state-heading"
          title="This deployment, right now"
          description="Read live from GovLayerCore and GovLayerAdmin — not from a cache, and not from a summary written in advance."
        />

        <div className="mt-6">
          {failure !== undefined ? (
            <UnverifiedNotice subject="Current governance state" error={failure} />
          ) : summary === undefined ? (
            <UnverifiedNotice
              subject="Current governance state"
              error={new Error("No governance state was returned")}
            />
          ) : (
            <Panel>
              <div className="flex flex-wrap items-center gap-3">
                <StateBadge
                  label={
                    summary.snapshot.paused
                      ? "New submissions paused"
                      : "Submissions open"
                  }
                  tone={summary.snapshot.paused ? "caution" : "positive"}
                />
                <span className="text-xs text-ink-subtle">{preset.label}</span>
              </div>

              <RecordList>
                <RecordRow
                  term="Proposals recorded"
                  value={formatInteger(summary.config.proposalCount)}
                />
                <RecordRow
                  term="Constitution version"
                  value={formatInteger(summary.config.constitutionVersion)}
                />
                <RecordRow
                  term="Quorum required"
                  value={`${formatInteger(summary.config.minQuorum)} ${
                    summary.config.votingWeightMode === "token_weighted"
                      ? "voting weight"
                      : "votes"
                  }`}
                />
                <RecordRow
                  term="Approval threshold"
                  value={`${formatInteger(summary.config.approvalThresholdPercent)}%`}
                />
                <RecordRow
                  term="Participation"
                  value={eligibilityModeLabel(summary.config.eligibilityMode)}
                />
                <RecordRow
                  term="Voting weight"
                  value={votingWeightModeLabel(summary.config.votingWeightMode)}
                />
                <RecordRow
                  term="Stewards"
                  value={formatInteger(BigInt(summary.snapshot.activeAdminCount))}
                />
              </RecordList>

              {/*
                Experience Blueprint section 10.1, section 5: see the decision
                journey in action. GovLayerCore assigns `proposal_id` by
                incrementing `proposal_count` at submission and never removes a
                record, so the most recently recorded proposal is exactly
                `proposal_count`. This is a direct reference to a real record,
                not a sample or a preview.
              */}
              {summary.config.proposalCount > 0n ? (
                <p className="mt-5 text-sm">
                  <Link
                    href={`/proposals/${summary.config.proposalCount.toString()}`}
                    className="underline"
                  >
                    See a decision journey in action — the most recent recorded
                    proposal (#{formatInteger(summary.config.proposalCount)})
                  </Link>
                </p>
              ) : (
                <p className="mt-5 text-sm text-ink-muted">
                  No proposal has been recorded on this deployment yet, so there is
                  no journey to inspect. The first submission appears here
                  immediately, together with its constitutional review.
                </p>
              )}
            </Panel>
          )}
        </div>
      </section>

      <section aria-labelledby="next-heading" className="mt-20">
        <SectionHeading id="next-heading" title="Where to go next" />
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Panel tone="sunken">
            <p className="font-display text-base text-ink">Explore governance</p>
            <p className="mt-2 text-sm text-ink-muted">
              Follow proposals through review, revision, voting, and determination
              — without a wallet.
            </p>
            <p className="mt-4 text-sm">
              <Link href="/explore" className="underline">
                Explore
              </Link>
            </p>
          </Panel>
          <Panel tone="sunken">
            <p className="font-display text-base text-ink">Read the constitution</p>
            <p className="mt-2 text-sm text-ink-muted">
              The rules every proposal is measured against, with the full version
              history.
            </p>
            <p className="mt-4 text-sm">
              <Link href="/constitution" className="underline">
                Constitution
              </Link>
            </p>
          </Panel>
          <Panel tone="sunken">
            <p className="font-display text-base text-ink">Verify a record</p>
            <p className="mt-2 text-sm text-ink-muted">
              Check what a proposal or stewardship action records, and reproduce it
              independently.
            </p>
            <p className="mt-4 text-sm">
              <Link href="/verify" className="underline">
                Verify
              </Link>
            </p>
          </Panel>
        </div>
      </section>


    </main>
  );
}
