/**
 * Time presentation helpers.
 *
 * All contract deadlines are Unix seconds from the contract's own runtime.
 * They are authoritative; everything here is derived presentation only
 * (Foundation Standard section 2.9 "Derived"), so a client clock that drifts
 * can make a countdown approximate -- it can never make a protocol action
 * valid or invalid. Contract timestamps are far below Number.MAX_SAFE_INTEGER,
 * so converting them to `number` is safe.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isPast(unixSeconds: number, now = nowUnixSeconds()): boolean {
  return now > unixSeconds;
}

/** Remaining seconds until a deadline; negative once it has passed. */
export function secondsUntil(unixSeconds: number, now = nowUnixSeconds()): number {
  return unixSeconds - now;
}

/**
 * Compact duration text: "3d 4h", "45m", "just under a minute".
 * Used for voting windows, dispute cooldowns, and timelocks.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));

  if (total === 0) return "0s";
  if (total < MINUTE) return `${total}s`;

  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Relative phrasing for contextual time ("Voting closes in 2 days").
 * Uses Intl rather than a date library (Foundation Standard section 5).
 */
export function formatRelative(unixSeconds: number, now = nowUnixSeconds()): string {
  const delta = unixSeconds - now;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const absolute = Math.abs(delta);

  if (absolute < MINUTE) return formatter.format(Math.round(delta), "second");
  if (absolute < HOUR) return formatter.format(Math.round(delta / MINUTE), "minute");
  if (absolute < DAY) return formatter.format(Math.round(delta / HOUR), "hour");
  if (absolute < YEAR) return formatter.format(Math.round(delta / DAY), "day");
  return formatter.format(Math.round(delta / YEAR), "year");
}

/** Absolute UTC rendering, for the technical/verification layer. */
export function formatUtcTimestamp(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(unixSeconds * 1000));
}

/** ISO-8601 UTC rendering, for copyable technical output. */
export function toIsoUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
