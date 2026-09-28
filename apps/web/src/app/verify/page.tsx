import { redirect } from "next/navigation";
import { PageHeader, Panel, SectionHeading } from "@/components/shared/Primitives";

/**
 * Verify (Experience Blueprint section 10.13).
 *
 * Two layers: a human-readable answer about what happened and what can be
 * checked, and a technical layer one level down. The identifier is resolved
 * server-side; a plain form submission works without JavaScript.
 */
export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  if (id !== undefined && id.trim() !== "") {
    redirect(`/verify/${encodeURIComponent(id.trim())}`);
  }

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Verify"
        title="Check a record"
        lede="Every value on this site comes from the contracts. This surface resolves a proposal or an authorized action and shows what was recorded — first in plain language, then as raw fields you can reproduce yourself."
      />

      <section aria-labelledby="lookup-heading" className="mt-10 max-w-prose">
        <SectionHeading
          id="lookup-heading"
          title="Look up a record"
          description="Enter a proposal number, or an authorized stewardship action identifier."
        />

        <form action="/verify" method="get" className="mt-6 flex flex-wrap gap-3">
          <label htmlFor="record-id" className="sr-only">
            Proposal number or action identifier
          </label>
          <input
            id="record-id"
            name="id"
            type="text"
            required
            placeholder="3 or ACTION-00000003"
            className="min-w-0 flex-1 rounded-card border border-line-control bg-surface-raised px-4 py-2.5 text-sm text-ink placeholder:text-ink-subtle"
          />
          <button
            type="submit"
            className="rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-accent-strong"
          >
            Verify
          </button>
        </form>

        <p className="mt-3 text-xs text-ink-subtle">
          Accepted forms: <span className="code-value">3</span>,{" "}
          <span className="code-value">#3</span>,{" "}
          <span className="code-value">proposal-3</span> for a proposal;{" "}
          <span className="code-value">ACTION-00000003</span> or{" "}
          <span className="code-value">action-3</span> for a stewardship action.
        </p>
      </section>

      <section aria-labelledby="layers-heading" className="mt-14">
        <SectionHeading id="layers-heading" title="What verification gives you" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Panel tone="sunken">
            <p className="text-sm text-ink">Human layer</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-muted">
              <li>What the record is and what happened to it.</li>
              <li>Its current or final state, in plain language.</li>
              <li>What in it can be checked, and how.</li>
            </ul>
          </Panel>
          <Panel tone="sunken">
            <p className="text-sm text-ink">Technical layer</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-muted">
              <li>Identifiers, raw recorded values, and timestamps.</li>
              <li>Contract and network details, so the read can be repeated.</li>
              <li>Nothing summarised away: the recorded text is shown verbatim.</li>
            </ul>
          </Panel>
        </div>

        <p className="mt-6 max-w-prose text-sm text-ink-muted">
          If an identifier cannot be resolved, this surface says so. It never
          guesses what was meant, and it never describes a read failure as a
          negative protocol outcome.
        </p>
      </section>
    </main>
  );
}
