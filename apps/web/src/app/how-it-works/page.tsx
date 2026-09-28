import Link from "next/link";
import { PageHeader, SectionHeading } from "@/components/shared/Primitives";

/**
 * How it works.
 *
 * The product explanation of the protocol lifecycle. Every statement here is
 * grounded in contract behaviour: review happens before voting, `rejected` and
 * `failed` are different outcomes, votes are immutable, disputes are narrow and
 * bounded, and a passed constitution amendment still requires an authorized
 * confirmation before the constitution changes.
 */
export const metadata = {
  title: "How it works · GovLayer",
  description:
    "The GovLayer lifecycle: constitutional review, revision and dispute, voting, and determination.",
};

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="How it works"
        title="Rules → Review → Decision → Record"
        lede="GovLayer adds one step ahead of ordinary governance: before a proposal can be voted on, it must be shown to comply with the constitution. Everything after that is recorded, so the whole journey can be inspected."
      />

      <div className="mt-12 space-y-14">
        <section aria-labelledby="proposal-heading" className="max-w-prose">
          <SectionHeading id="proposal-heading" title="1. A proposal is submitted" />
          <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            <p>
              A proposer submits a title, a description, and a requested voting
              duration. A proposal can also be a constitution amendment, in which
              case the proposed text is submitted with it.
            </p>
            <p>
              At submission the protocol captures the constitution text the
              proposal will be measured against. That snapshot travels with the
              proposal: later review, revision, and dispute all use it, so a
              proposal is never judged against rules that changed while it was in
              flight.
            </p>
            <p>
              Submission is subject to the DAO&rsquo;s participation rules and rate
              limits. While a pause is active, new submissions are refused — a
              containment measure that does not stop voting, disputing, finalizing,
              resubmitting, or cancelling.
            </p>
          </div>
        </section>

        <section aria-labelledby="review-heading" className="max-w-prose">
          <SectionHeading id="review-heading" title="2. Constitutional review" />
          <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            <p>
              Review asks one question: does this proposal comply with the
              constitution? It produces one of three outcomes:
            </p>
            <ul className="list-inside list-disc space-y-1">
              <li>
                <span className="text-ink">accepted</span> — compliant, and
                eligible for voting;
              </li>
              <li>
                <span className="text-ink">needs revision</span> — fundamentally
                sound, but requiring clarification;
              </li>
              <li>
                <span className="text-ink">rejected</span> — it conflicts with the
                constitution, or introduces risks.
              </li>
            </ul>
            <p>
              Review is a compliance judgment, not a popularity contest. A rejected
              proposal has not been voted down, and a proposal that fails a vote
              has not been rejected by review.
            </p>
          </div>
        </section>

        <section aria-labelledby="revision-heading" className="max-w-prose">
          <SectionHeading id="revision-heading" title="3. Revision" />
          <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            <p>
              A proposal that needs revision can be resubmitted with a revised
              description and is reviewed again — against the same original
              constitution snapshot. The protocol allows a bounded number of
              resubmissions, and each one records what the previous review said.
            </p>
            <p>
              Only the original proposer can resubmit, and a proposal rejected in
              review cannot be resubmitted at all.
            </p>
          </div>
        </section>

        <section aria-labelledby="dispute-heading" className="max-w-prose">
          <SectionHeading id="dispute-heading" title="4. Dispute" />
          <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            <p>
              A rejected proposal can be disputed — a narrow reevaluation of whether
              the rejection was correct, judged against the same snapshot. The
              proposer, or an address that voted on the proposal, may raise one.
            </p>
            <p>
              Disputes are bounded: a limited number of stages with a mandatory
              cooldown between them. If a dispute overturns a rejection, the
              proposal reopens for voting with a fresh voting window. A dispute
              never approves a proposal by itself.
            </p>
            <p>
              A proposal that failed a vote cannot be disputed. That outcome is a
              governance result, not a judgment about compliance.
            </p>
          </div>
        </section>
        <section aria-labelledby="voting-heading" className="max-w-prose">
          <SectionHeading id="voting-heading" title="5. Voting" />
          <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            <p>
              Only proposals accepted by review reach a vote. Eligibility follows
              the DAO&rsquo;s configuration: open to any address, restricted to
              token or NFT holders, optionally combined with a whitelist. Voting
              weight is either equal or weighted by token balance.
            </p>
            <p>
              A vote is immutable once recorded. It cannot be changed, withdrawn,
              or recast, and the protocol records the tally rather than individual
              votes.
            </p>
          </div>
        </section>

        <section aria-labelledby="determination-heading" className="max-w-prose">
          <SectionHeading id="determination-heading" title="6. Determination" />
          <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            <p>
              When the voting window closes, the outcome is finalized against the
              configured quorum and approval threshold. The result is either passed
              or failed, recorded with the counts that produced it.
            </p>
            <p>
              Finalization is open to anyone; it does not depend on a particular
              official remembering to act.
            </p>
          </div>
        </section>

        <section aria-labelledby="amendment-heading" className="max-w-prose">
          <SectionHeading
            id="amendment-heading"
            title="7. Changing the constitution itself"
          />
          <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            <p>
              A constitution amendment that passes its vote is not yet applied. It
              moves to awaiting confirmation, where an authorized stewardship
              action must authorize the change, and the governance contract
              independently validates that authorization against its current state
              before the constitution advances to a new version.
            </p>
            <p>
              If the governance contract&rsquo;s state changed in a way that makes
              the authorization invalid, the change is permanently declined rather
              than applied — and the record says so.
            </p>
          </div>
        </section>

        <section aria-labelledby="record-heading">
          <SectionHeading
            id="record-heading"
            title="8. What the record contains"
            description="Every transition is appended to the contract's own governance history, alongside the proposal itself."
          />
          <dl className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-card border border-line p-5">
              <dt className="text-sm text-ink">The proposal</dt>
              <dd className="mt-2 text-sm text-ink-muted">
                Description, review decision and explanation, conflicts, the
                constitution snapshot, tallies, and deadlines.
              </dd>
            </div>
            <div className="rounded-card border border-line p-5">
              <dt className="text-sm text-ink">The lifecycle</dt>
              <dd className="mt-2 text-sm text-ink-muted">
                Submissions, revisions, disputes, determinations, and
                confirmations, in the order they were recorded.
              </dd>
            </div>
            <div className="rounded-card border border-line p-5">
              <dt className="text-sm text-ink">The verification layer</dt>
              <dd className="mt-2 text-sm text-ink-muted">
                Raw recorded values and contract addresses, so any claim on this
                site can be reproduced independently.
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="boundaries-heading" className="max-w-prose">
          <SectionHeading
            id="boundaries-heading"
            title="What this interface will not claim"
          />
          <ul className="mt-4 space-y-2 text-[0.9375rem] leading-relaxed text-ink-muted">
            <li>
              Individual votes are not shown, because the protocol records the tally
              rather than who cast what. Whether a specific address has voted is
              answered by the protocol at the moment of voting.
            </li>
            <li>
              No outcome is predicted. There is no probability of passing and no
              governance health score, because the protocol does not produce one.
            </li>
            <li>
              Where a value cannot be read, the interface says it could not be
              verified rather than presenting an assumption.
            </li>
          </ul>
        </section>

      </div>

      <p className="mt-14 text-sm">
        <Link href="/explore" className="underline">
          Explore live governance
        </Link>{" "}
        ·{" "}
        <Link href="/constitution" className="underline">
          Read the constitution
        </Link>{" "}
        ·{" "}
        <Link href="/verify" className="underline">
          Verify a record
        </Link>
      </p>
    </main>
  );
}
