"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shared/Primitives";
import { TechnicalDetails } from "@/components/shared/Notices";
import { toAppError } from "@/lib/errors";

/**
 * Route error boundary.
 *
 * Experience Blueprint section 12: state what happened, whether it is
 * recoverable, and what the visitor can do next. The recorded detail sits one
 * level down rather than being the primary message.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const appError = toAppError(error);

  return (
    <main className="mx-auto max-w-shell px-6 py-16">
      <PageHeader
        eyebrow="Something went wrong"
        title="This surface could not be loaded"
        lede="The interface could not complete a read from the contracts. Nothing about protocol state has been assumed or changed."
      />

      <div role="alert" className="mt-8 max-w-prose">
        <p className="text-sm text-ink">{appError.message}</p>
        {appError.nextStep === undefined ? null : (
          <p className="mt-2 text-sm text-ink-muted">{appError.nextStep}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-card border border-line-control px-4 py-2 text-sm text-ink hover:border-ink-muted"
          >
            Try again
          </button>
          <Link
            href="/explore"
            className="rounded-card border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink"
          >
            Back to Explore
          </Link>
        </div>
        <TechnicalDetails error={appError} />
      </div>
    </main>
  );
}
