import Link from "next/link";
import { inspectRuntimeConfig } from "@/config/env";
import { formatInteger } from "@/lib/format";
import { loadConstitutionVersion, loadGovernanceConfig } from "@/server/reads";
import {
  PageHeader,
  Panel,
  Prose,
  RecordList,
  RecordRow,
  SectionHeading,
} from "@/components/shared/Primitives";
import {
  ConfigurationIncompleteNotice,
  ContextualError,
  UnverifiedNotice,
} from "@/components/shared/Notices";
import { formatUtcTimestamp } from "@/lib/time";
import { shortenAddress } from "@/lib/hex";

/**
 * Constitution (Experience Blueprint section 10.11).
 *
 * A first-class product area: the rules every proposal is measured against, with
 * their version history. Presented as readable text rather than a raw dump, and
 * every proposal elsewhere links back to the snapshot it was measured against.
 */
export const dynamic = "force-dynamic";

export default async function ConstitutionPage() {
  const inspected = inspectRuntimeConfig();

  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader
          eyebrow="Constitution"
          title="The rules this DAO governs itself by"
        />
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  let current: Awaited<ReturnType<typeof loadConstitutionVersion>> | undefined;
  let failure: unknown;

  try {
    const config = await loadGovernanceConfig();
    current = await loadConstitutionVersion(config.constitutionVersion);
  } catch (error) {
    failure = error;
  }

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Constitution"
        title="The rules this DAO governs itself by"
        lede="Every proposal is measured against this text before it can be voted on. Proposals record the text they were measured against, so a later amendment never quietly changes an earlier judgment."
      />

      {failure !== undefined ? (
        <div className="mt-10">
          <ContextualError subject="The constitution" error={failure} />
        </div>
      ) : current === undefined ? (
        <div className="mt-10">
          <UnverifiedNotice
            subject="The constitution"
            error={new Error("No constitution version was returned")}
          />
        </div>
      ) : (
        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <section aria-labelledby="current-heading">
            <SectionHeading
              id="current-heading"
              title={`Version ${formatInteger(current.version.version)} — in force`}
              description="Recorded exactly as adopted. Amendments become part of the constitution only after a vote and an authorized confirmation."
            />
            <div className="mt-6">
              <Prose>{current.version.text}</Prose>
            </div>
          </section>

          <aside className="lg:sticky lg:top-8 lg:self-start">
            <Panel tone="sunken">
              <p className="text-sm font-medium text-ink">Version details</p>
              <RecordList>
                <RecordRow
                  term="Version"
                  value={formatInteger(current.version.version)}
                />
                <RecordRow
                  term="Adopted"
                  value={`${formatUtcTimestamp(current.version.adoptedAt)} UTC`}
                />
                <RecordRow
                  term="Adopted by"
                  value={
                    current.version.adoptedBy === "genesis"
                      ? "Genesis deployment"
                      : shortenAddress(current.version.adoptedBy)
                  }
                  code={current.version.adoptedBy !== "genesis"}
                />
                <RecordRow
                  term="Via proposal"
                  value={
                    current.proposalId === null ? (
                      "None (genesis)"
                    ) : (
                      <Link
                        href={`/proposals/${current.proposalId.toString()}`}
                        className="underline"
                      >
                        Proposal #{current.proposalId.toString()}
                      </Link>
                    )
                  }
                />
              </RecordList>

              <p className="mt-5 text-sm">
                <Link href="/constitution/history" className="underline">
                  Version history
                </Link>
              </p>
            </Panel>

            <p className="mt-4 text-xs text-ink-subtle">
              Current version number:{" "}
              {formatInteger(current.config.constitutionVersion)}. Proposals
              reference the text captured when they were submitted, not this
              version number.
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}
