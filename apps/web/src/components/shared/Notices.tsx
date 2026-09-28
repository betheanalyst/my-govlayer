import Link from "next/link";
import type { ReactNode } from "react";
import { AppError, toAppError } from "@/lib/errors";

/**
 * Notice primitives.
 *
 * Experience Blueprint sections 12 and 13: an empty state explains why it is
 * empty and what happens next; an error states what happened, whether it is
 * recoverable, and what to do next; a failed read is never presented as a
 * negative protocol answer.
 */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line-control bg-surface-sunken p-8 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-prose text-sm text-ink-muted">
        {description}
      </p>
      {action === undefined ? null : <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Verification uncertainty: a read that could not be completed. Deliberately
 * phrased so it can never be mistaken for a negative result.
 */
export function UnverifiedNotice({
  subject,
  error,
}: {
  subject: string;
  error: unknown;
}) {
  const appError = toAppError(error);

  return (
    <div
      role="status"
      className="rounded-card border border-line bg-surface-sunken p-6"
    >
      <p className="text-sm font-medium text-ink">
        {subject} could not be verified right now.
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        This is a read problem, not a protocol outcome. Retrying is safe.
      </p>
      <TechnicalDetails error={appError} />
    </div>
  );
}

/**
 * Actionable failure: what happened, whether it can be retried, and the recorded
 * technical detail one level down.
 */
export function ContextualError({
  subject,
  error,
}: {
  subject: string;
  error: unknown;
}) {
  const appError = toAppError(error);

  return (
    <div role="alert" className="rounded-card border border-line bg-surface-sunken p-6">
      <p className="text-sm font-medium text-ink">{appError.message}</p>
      {appError.nextStep === undefined ? null : (
        <p className="mt-1 text-sm text-ink-muted">{appError.nextStep}</p>
      )}
      <p className="mt-2 text-xs uppercase tracking-[0.14em] text-ink-subtle">
        {appError.recoverable ? "Recoverable" : "Not recoverable"} · {subject}
      </p>
      <TechnicalDetails error={appError} />
    </div>
  );
}

/** Progressive disclosure: the recorded detail, one click below the summary. */
export function TechnicalDetails({ error }: { error: AppError }) {
  if (error.raw === undefined || error.raw === "") return null;

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs text-ink-subtle hover:text-ink-muted">
        Recorded detail
      </summary>
      <p className="mt-2 break-words font-mono text-xs text-ink-muted">
        {error.raw}
      </p>
    </details>
  );
}

export function LoadingNote({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-ink-muted">
      {label}
    </p>
  );
}

/** Honest configuration state: no invented fallbacks, no partial data. */
export function ConfigurationIncompleteNotice({
  issues,
}: {
  issues: readonly string[];
}) {
  return (
    <div className="rounded-card border border-line bg-surface-sunken p-6">
      <p className="text-sm font-medium text-ink">
        This interface cannot reach a GovLayer deployment yet.
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Contract addresses are never invented or defaulted, so no protocol data
        is shown until configuration is complete.
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {issues.map((issue) => (
          <li
            key={issue}
            className="rounded-card border border-line bg-surface-raised p-3 text-ink-muted"
          >
            {issue}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-subtle">
        Provide these values in <code className="code-value">apps/web/.env.local</code>
        {" "}— see <code className="code-value">.env.example</code>.{" "}
        <Link href="/verify" className="underline">
          Verification guidance
        </Link>
      </p>
    </div>
  );
}
