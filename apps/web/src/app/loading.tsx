import { PageHeader } from "@/components/shared/Primitives";

/**
 * Route-level loading state.
 *
 * Experience Blueprint section 13: loading copy names what is being loaded, and
 * never implies that protocol state has already changed.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="GovLayer"
        title="Reading the governance record"
        lede="Reading directly from the contracts on GenLayer. This is the protocol's own record, so it takes as long as the network takes."
      />
      <p role="status" className="mt-8 text-sm text-ink-muted">
        Loading governance record…
      </p>
    </main>
  );
}
