import Link from "next/link";
import { notFound } from "next/navigation";
import { inspectRuntimeConfig } from "@/config/env";
import { isAppError } from "@/lib/errors";
import { formatInteger } from "@/lib/format";
import { loadConstitutionVersion } from "@/server/reads";
import {
  PageHeader,
  Panel,
  Prose,
  RecordList,
  RecordRow,
} from "@/components/shared/Primitives";
import { ConfigurationIncompleteNotice } from "@/components/shared/Notices";
import { formatUtcTimestamp } from "@/lib/time";

/**
 * One constitution version (Experience Blueprint section 10.12).
 *
 * Shows the version, its status (in force or historical), when it was adopted,
 * the proposal that produced it where one is recorded, its full text, and the
 * neighbouring versions.
 */
export const dynamic = "force-dynamic";

export default async function ConstitutionVersionPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version: rawVersion } = await params;

  if (!/^\d+$/.test(rawVersion)) {
    notFound();
  }

  const version = BigInt(rawVersion);

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Constitution" title={`Version ${rawVersion}`} />
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  let record: Awaited<ReturnType<typeof loadConstitutionVersion>>;
  try {
    record = await loadConstitutionVersion(version);
  } catch (error) {
    if (isAppError(error) && error.kind === "not_found") {
      notFound();
    }
    throw error;
  }

  const isCurrent = record.version.version === record.config.constitutionVersion;
  const hasPrevious = record.version.version > 1n;
  const hasNext = record.version.version < record.config.constitutionVersion;

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Constitution"
        title={`Version ${formatInteger(record.version.version)}`}
        lede={
          isCurrent
            ? "This version is in force. Every new proposal is measured against this text."
            : "This version is historical. It has been superseded by a later amendment."
        }
      >
        <nav aria-label="Version navigation" className="flex flex-wrap gap-4 text-sm">
          <Link href="/constitution/history" className="underline">
            All versions
          </Link>
          {hasPrevious ? (
            <Link
              href={`/constitution/${(record.version.version - 1n).toString()}`}
              className="underline"
            >
              ← Version {(record.version.version - 1n).toString()}
            </Link>
          ) : null}
          {hasNext ? (
            <Link
              href={`/constitution/${(record.version.version + 1n).toString()}`}
              className="underline"
            >
              Version {(record.version.version + 1n).toString()} →
            </Link>
          ) : null}
        </nav>
      </PageHeader>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section aria-labelledby="text-heading">
          <h2 id="text-heading" className="text-xl">
            Text
          </h2>
          <div className="mt-6">
            {record.version.text.trim() === "" ? (
              <p className="text-sm text-ink-muted">No text is recorded.</p>
            ) : (
              <Prose>{record.version.text}</Prose>
            )}
          </div>
        </section>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Panel tone="sunken">
            <p className="text-sm font-medium text-ink">Version details</p>
            <RecordList>
              <RecordRow
                term="Version"
                value={formatInteger(record.version.version)}
              />
              <RecordRow term="Status" value={isCurrent ? "In force" : "Historical"} />
              <RecordRow
                term="Adopted"
                value={`${formatUtcTimestamp(record.version.adoptedAt)} UTC`}
              />
              <RecordRow
                term="Adopted by"
                value={
                  record.version.adoptedBy === "genesis"
                    ? "Genesis deployment"
                    : record.version.adoptedBy
                }
                code={record.version.adoptedBy !== "genesis"}
              />
              <RecordRow
                term="Via proposal"
                value={
                  record.proposalId === null ? (
                    "None recorded"
                  ) : (
                    <Link
                      href={`/proposals/${record.proposalId.toString()}`}
                      className="underline"
                    >
                      Proposal #{record.proposalId.toString()}
                    </Link>
                  )
                }
              />
            </RecordList>
            <p className="mt-4 text-xs text-ink-subtle">
              A version number is not carried on proposals: each proposal records
              the constitution text captured at its submission.
            </p>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
