/**
 * Bounded-read windowing.
 *
 * Both contracts use the same pagination convention: 0-based `offset`,
 * `limit` must be greater than zero, and every listing walks oldest-first.
 * Proposal IDs are 1-based and contiguous (`proposal_count`), so a
 * newest-first view is a *descending window* computed from the total, not a
 * contract feature.
 *
 * These helpers exist so no UI code computes offsets ad hoc (Foundation
 * Standard sections 2.7 and 12: bounded reads, no N+1 behaviour).
 */

export interface ReadWindow {
  /** 0-based offset to pass to the contract view. */
  readonly offset: number;
  /** Number of records to request. Always greater than zero. */
  readonly limit: number;
  /** True when at least one older record exists beyond this window. */
  readonly hasOlder: boolean;
  /**
   * True when this window contains no records. An empty window must never be
   * sent to the contract: both contracts reject a limit of zero outright, so
   * callers skip the read and render an empty state instead.
   */
  readonly isEmpty: boolean;
}

export function pageCount(total: number, pageSize: number): number {
  assertPositive(pageSize, "pageSize");
  if (total <= 0) return 0;
  return Math.ceil(total / pageSize);
}

/**
 * Oldest-first window, for a listing read that starts at the beginning of the
 * collection. This is the shape the contract itself provides.
 */
export function ascendingWindow(
  total: number,
  page: number,
  pageSize: number,
): ReadWindow {
  assertNonNegative(page, "page");
  assertPositive(pageSize, "pageSize");

  const safeTotal = Math.max(0, total);
  const offset = page * pageSize;
  const limit = Math.max(0, Math.min(pageSize, safeTotal - offset));

  return {
    offset,
    limit,
    hasOlder: offset + pageSize < safeTotal,
    isEmpty: limit === 0,
  };
}

/**
 * Newest-first window.
 *
 * A page of size N always covers the N *newest* records not yet shown:
 * page 0 is the tail of the collection, page 1 the N before that, and so on.
 * The final page may be shorter than `pageSize` when the total is not an exact
 * multiple.
 */
export function descendingWindow(
  total: number,
  page: number,
  pageSize: number,
): ReadWindow {
  assertNonNegative(page, "page");
  assertPositive(pageSize, "pageSize");

  const safeTotal = Math.max(0, total);
  const end = safeTotal - page * pageSize;
  const start = Math.max(0, end - pageSize);
  const limit = Math.max(0, end - start);

  return {
    offset: start,
    limit,
    hasOlder: start > 0,
    isEmpty: limit === 0,
  };
}

/**
 * Clamps a caller-supplied page size to a safe maximum. Contract views reject
 * a non-positive limit outright, so a floor of 1 is applied too.
 */
export function clampPageSize(
  pageSize: number,
  max = 100,
): number {
  if (!Number.isFinite(pageSize)) return max;
  return Math.min(max, Math.max(1, Math.floor(pageSize)));
}

function assertPositive(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}
