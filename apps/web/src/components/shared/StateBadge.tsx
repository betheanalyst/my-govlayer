import {
  Check,
  CircleDot,
  CircleSlash,
  Clock,
  HelpCircle,
  Minus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/domain/labels";
import { cn } from "@/lib/cn";

/**
 * Status badge.
 *
 * Two rules from the specifications are structural here, not decorative:
 *   1. `rejected` (review) and `failed` (determination) use different tones and
 *      different icons, so they can never read as the same kind of outcome.
 *   2. A badge always carries a text label and an icon, so status is never
 *      conveyed by colour alone (accessibility baseline).
 */

const TONE_CLASSES: Record<Tone, string> = {
  info: "border-accent/25 bg-accent-soft text-accent-strong",
  positive:
    "border-state-determination-passed/30 bg-state-determination-passedSoft text-state-determination-passed",
  caution:
    "border-state-review-revision/30 bg-state-review-revisionSoft text-state-review-revision",
  "review-negative":
    "border-state-review-rejected/30 bg-state-review-rejectedSoft text-state-review-rejected",
  "determination-negative":
    "border-state-determination-failed/30 bg-state-determination-failedSoft text-state-determination-failed",
  neutral: "border-line-strong bg-surface-raised text-ink-muted",
  unknown: "border-line-strong bg-surface-sunken text-ink-subtle",
};

const TONE_ICONS: Record<Tone, LucideIcon> = {
  info: CircleDot,
  positive: Check,
  caution: Clock,
  "review-negative": XCircle,
  "determination-negative": CircleSlash,
  neutral: Minus,
  unknown: HelpCircle,
};

export function StateBadge({
  label,
  tone,
  className,
}: {
  label: string;
  tone: Tone;
  className?: string;
}) {
  const Icon = TONE_ICONS[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
  );
}

/** Small, quiet label for supporting facts that are not statuses. */
export function MetaChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-xs text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
