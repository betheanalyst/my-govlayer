import Link from "next/link";
import type { ReactNode } from "react";
import { formatDuration, formatRelative, formatUtcTimestamp } from "@/lib/time";
import { cn } from "@/lib/cn";

/**
 * Layout and disclosure primitives.
 *
 * Experience Blueprint sections 20 and 25: cards only where containment adds
 * meaning, open editorial layouts for long-form content (constitution,
 * reasoning, history).
 */

export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-line pb-8">
      {eyebrow === undefined ? null : (
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-3 text-3xl sm:text-4xl">{title}</h1>
      {lede === undefined ? null : (
        <p className="mt-4 max-w-prose text-ink-muted">{lede}</p>
      )}
      {children === undefined ? null : <div className="mt-6">{children}</div>}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  id,
}: {
  title: string;
  description?: string;
  id?: string;
}) {
  return (
    <div>
      <h2 id={id} className="text-xl">
        {title}
      </h2>
      {description === undefined ? null : (
        <p className="mt-2 max-w-prose text-sm text-ink-muted">{description}</p>
      )}
    </div>
  );
}

/** Contained surface, used only where containment adds meaning. */
export function Panel({
  children,
  className,
  tone = "raised",
  ariaLive,
}: {
  children: ReactNode;
  className?: string;
  tone?: "raised" | "sunken";
  /** Set on panels whose content changes as the result of an action. */
  ariaLive?: "polite" | "assertive";
}) {
  return (
    <div
      aria-live={ariaLive}
      className={cn(
        "rounded-card border border-line p-6",
        tone === "raised" ? "bg-surface-raised" : "bg-surface-sunken",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function RecordList({ children }: { children: ReactNode }) {
  return <dl className="mt-4">{children}</dl>;
}

export function RecordRow({
  term,
  value,
  code = false,
}: {
  term: string;
  value: ReactNode;
  code?: boolean;
}) {
  return (
    <div className="record-row">
      <dt className="record-term">{term}</dt>
      <dd className={code ? "record-value code-value" : "record-value"}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Long-form protocol text: constitution text, AI reasoning, recorded details.
 * Rendered as open prose rather than inside a card.
 */
export function Prose({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-prose whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Recorded value shown verbatim; never reworded or summarised. */
export function RecordedText({ value }: { value: string }) {
  return (
    <p className="max-w-prose break-words font-mono text-xs text-ink-muted">
      {value}
    </p>
  );
}

/**
 * Derived timing phrasing (Blueprint section 14): contextual time instead of raw
 * timestamps, with the exact recorded instant available beneath it.
 *
 * The caller supplies both phrasings, so a deadline that has passed is never
 * described in future language.
 */
export function TimingNote({
  futureLabel,
  pastLabel,
  at,
  now,
  showAbsolute = true,
}: {
  futureLabel: string;
  pastLabel: string;
  at: number;
  now: number;
  showAbsolute?: boolean;
}) {
  const phrase = at <= now ? pastLabel : futureLabel;

  return (
    <p className="text-sm text-ink-muted">
      {phrase} {formatRelative(at, now)}
      {showAbsolute ? (
        <span className="mt-1 block text-xs text-ink-subtle">
          {formatUtcTimestamp(at)} UTC
        </span>
      ) : null}
    </p>
  );
}

/** Duration phrased from contract configuration values. */
export function DurationNote({ seconds }: { seconds: number }) {
  return <span>{formatDuration(seconds)}</span>;
}

/**
 * Link-based pagination. Uses the URL rather than client state so back/forward
 * and sharing behave, and no JavaScript is required to page.
 */
export function Pagination({
  page,
  pageCount,
  hrefForPage,
  label,
}: {
  page: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
  label: string;
}) {
  if (pageCount <= 1) return null;

  const hasPrevious = page > 0;
  const hasNext = page < pageCount - 1;

  return (
    <nav
      aria-label={label}
      className="mt-8 flex items-center justify-between gap-4 border-t border-line pt-6 text-sm"
    >
      {hasPrevious ? (
        <Link
          href={hrefForPage(page - 1)}
          className="rounded-card text-ink-muted hover:text-ink"
        >
          ← Newer
        </Link>
      ) : (
        <span className="text-ink-subtle">← Newer</span>
      )}

      <span className="text-ink-subtle">
        Page {page + 1} of {pageCount}
      </span>

      {hasNext ? (
        <Link
          href={hrefForPage(page + 1)}
          className="rounded-card text-ink-muted hover:text-ink"
        >
          Older →
        </Link>
      ) : (
        <span className="text-ink-subtle">Older →</span>
      )}
    </nav>
  );
}
