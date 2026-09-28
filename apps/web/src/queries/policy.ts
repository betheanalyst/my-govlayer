import { classifyError, isAppError } from "@/lib/errors";

/**
 * Query policy: freshness windows and retry behaviour.
 *
 * Everything here serves two requirements (Foundation Standard sections 2.7 and
 * 12): bounded, non-repeating reads, and never treating a failed read as a
 * negative protocol answer.
 */

/**
 * Staleness windows, in milliseconds. These are chosen per record type rather
 * than globally:
 *   - governance configuration changes only through an authorized stewardship
 *     action, so it can be cached longest;
 *   - proposal lists and individual proposals change as people vote, so they are
 *     shorter-lived;
 *   - stewardship state changes on approval/timelock boundaries, so it is
 *     refreshed most eagerly.
 */
export const STALE_TIME = {
  config: 60_000,
  proposals: 30_000,
  proposal: 30_000,
  revisions: 60_000,
  history: 60_000,
  constitution: 300_000,
  adminSnapshot: 15_000,
  adminActions: 15_000,
  actionHistory: 60_000,
  actionApplied: 30_000,
} as const;

export const DEFAULT_GC_TIME = 5 * 60_000;

/** At most two extra attempts: RPC hiccups are transient, storms are not. */
export const MAX_READ_RETRIES = 2;

/**
 * Retries only failures that could plausibly succeed on a second attempt.
 *
 * A definitive protocol answer -- not found, a protocol-state restriction, a
 * user restriction, a validation rejection, or missing configuration -- is
 * *never* retried: retrying cannot change it, and presenting it as a transient
 * problem would misreport protocol state.
 */
export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_READ_RETRIES) return false;

  const classified = isAppError(error) ? error : classifyError(error);

  return (
    classified.kind === "verification_uncertainty" ||
    classified.kind === "cross_contract" ||
    classified.kind === "unknown"
  );
}
