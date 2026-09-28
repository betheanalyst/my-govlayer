import Link from "next/link";
import { inspectRuntimeConfig } from "@/config/env";
import { formatInteger } from "@/lib/format";
import { loadConstitutionHistoryPage } from "@/server/reads";
import { PageHeader, Pagination, Panel } from "@/components/shared/Primitives";
import {
  ConfigurationIncompleteNotice,
  EmptyState,
  UnverifiedNotice,
} from "@/components/shared/Notices";
import { shortenAddress } from "@/lib/hex";
import { formatUtcTimestamp } from "@/lib/time";

/**
 * Constitution version history (Experience Blueprint sections 10.11, 10.12).
 *
 * Versions are append-only and numbered from 1. Newest first, with the version in
 * force marked, so a reader can see both progression and current state.
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

function historyHref(page: number): string {
  return page > 0 ? `/constitution/history?page=${page}` : "/constitution/history";
}

export default async function ConstitutionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? "0", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 0;

  const inspected = inspectRuntimeConfig();
  if (!inspected.ok) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Constitution" title="Version history" />
        <div className="mt-8">
          <ConfigurationIncompleteNotice issues={inspected.error.issues} />
        </div>
      </main>
    );
  }

  let history: Awaited<ReturnType<typeof loadConstitutionHistoryPage>> | undefined;
  let failure: unknown;

  try {
    history = await loadConstitutionHistoryPage(page, PAGE_SIZE);
  } catch (error) {
    failure = error;
  }

  if (failure !== undefined || history === undefined) {
    return (
      <main className="mx-auto max-w-shell px-6 py-16">
        <PageHeader eyebrow="Constitution" title="Version history" />
        <div className="mt-8">
          <UnverifiedNotice
            subject="The constitution version history"
            error={failure ?? new Error("No versions were returned")}
          />
        </div>
      </main>
    );
  }

  const pageCount = Math.max(1, Math.ceil(history.total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Constitution"
        title="Version history"
        lede="Every version of the constitution this DAO has adopted, newest first. Each amendment becomes part of the constitution only after a vote and an authorized confirmation."
      />

      <p className="mt-6 text-xs text-ink-subtle">
        {formatInteger(history.currentVersion)} version
        {history.currentVersion === 1n ? "" : "s"} recorded · version{" "}
        {formatInteger(history.currentVersion)} is in force
      </p>

      {history.versions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No versions in this window"
            description="The constitution always has at least one version, recorded at deployment. Try an earlier page."
            action={
              <Link href={historyHref(0)} className="underline">
                Back to the newest versions
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {history.versions.map((version) => {
            const isCurrent = version.version === history.currentVersion;

            return (
              <li key={version.version.toString()}>
                <Panel tone={isCurrent ? "raised" : "sunken"}>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-ink">
                      <Link
                        href={`/constitution/${version.version.toString()}`}
                        className="hover:underline"
                      >
                        Version {formatInteger(version.version)}
                      </Link>
                      {isCurrent ? (
                        <span className="ml-2 text-xs uppercase tracking-[0.14em] text-accent">
                          In force
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      adopted {formatUtcTimestamp(version.adoptedAt)} UTC
                    </p>
                  </div>

                  <p className="mt-2 text-xs text-ink-muted">
                    Adopted by{" "}
                    {version.adoptedBy === "genesis"
                      ? "the genesis deployment"
                      : shortenAddress(version.adoptedBy)}
                    {version.adoptedViaProposalId > 0n ? (
                      <>
                        {" · via "}
                        <Link
                          href={`/proposals/${version.adoptedViaProposalId.toString()}`}
                          className="underline"
                        >
                          proposal #{version.adoptedViaProposalId.toString()}
                        </Link>
                      </>
                    ) : (
                      " · no originating proposal"
                    )}
                  </p>

                  <p className="mt-3 line-clamp-2 max-w-prose text-sm text-ink-muted">
                    {version.text.slice(0, 240)}
                    {version.text.length > 240 ? "…" : ""}
                  </p>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={safePage}
        pageCount={pageCount}
        hrefForPage={historyHref}
        label="Constitution version pages"
      />
    </main>
  );
}
