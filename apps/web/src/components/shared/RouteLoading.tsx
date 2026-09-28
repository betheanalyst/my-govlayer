import { PageHeader } from "@/components/shared/Primitives";

/**
 * Route-level loading state (Experience Blueprint section 13).
 *
 * The copy names what is being loaded and says what the interface is doing,
 * rather than implying that protocol state has already changed. Each route
 * supplies its own subject so a reader always knows which read is in flight.
 */
export function RouteLoading({
  subject,
  detail,
}: {
  /** What is being read, in the spec's vocabulary: "Loading proposal record". */
  readonly subject: string;
  readonly detail?: string;
}) {
  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="GovLayer"
        title={subject}
        lede={
          detail ??
          "Reading directly from the contracts on GenLayer. This is the protocol's own record, so it takes as long as the network takes."
        }
      />
      <p role="status" className="mt-8 text-sm text-ink-muted">
        {subject}…
      </p>
      <p className="mt-2 max-w-prose text-xs text-ink-subtle">
        Nothing is assumed while this runs, and no outcome is predicted.
      </p>
    </main>
  );
}
