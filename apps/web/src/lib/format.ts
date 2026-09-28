/**
 * BigInt-safe value formatting (Foundation Standard section 11).
 *
 * Protocol amounts (token balances, voting weights, tallies) may exceed
 * JavaScript's safe integer range. They are never routed through `Number`;
 * grouping and decimal placement are performed on the decimal string itself.
 * `Number` is used only for small, bounded counts where it is provably safe.
 */

/** Groups a non-negative decimal integer string with thin separators. */
function groupDigits(decimal: string): string {
  return decimal.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a whole protocol value (vote weight, tally, balance with zero
 * decimals) for display. Exact: no precision is lost.
 */
export function formatInteger(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString(10);
  return `${negative ? "-" : ""}${groupDigits(digits)}`;
}

/**
 * Formats a fixed-point protocol amount.
 *
 * `decimals` must come from a trusted source (configuration or the token's own
 * interface). GovLayerCore/Admin themselves expose only integer governance
 * values, so this exists for token amounts introduced later.
 */
export function formatFixedPoint(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer`);
  }

  const negative = value < 0n;
  const magnitude = (negative ? -value : value).toString(10);
  const padded = magnitude.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = decimals === 0 ? "" : padded.slice(padded.length - decimals);
  const trimmedFraction = fraction.replace(/0+$/, "");

  const body =
    trimmedFraction === ""
      ? groupDigits(whole)
      : `${groupDigits(whole)}.${trimmedFraction}`;

  return `${negative ? "-" : ""}${body}`;
}

/**
 * Integer-exact ratio as a percentage string, e.g. "62.5%".
 * Returns null when the denominator is zero, because "0 of 0" has no
 * meaningful percentage -- the caller must decide how to present that.
 */
export function formatRatioPercent(
  numerator: bigint,
  denominator: bigint,
  fractionDigits = 1,
): string | null {
  if (denominator === 0n) return null;
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new RangeError(`fractionDigits must be a non-negative integer`);
  }

  const scale = 10n ** BigInt(fractionDigits);
  // Rounded half-up on the scaled integer, entirely in BigInt.
  const scaled = ((numerator * 100n * scale) + denominator / 2n) / denominator;
  const whole = scaled / scale;
  const fraction = scaled % scale;

  if (fractionDigits === 0 || fraction === 0n) {
    return `${whole.toString(10)}%`;
  }

  const fractionText = fraction
    .toString(10)
    .padStart(fractionDigits, "0")
    .replace(/0+$/, "");

  return `${whole.toString(10)}.${fractionText}%`;
}

/** "1 proposal" / "3 proposals" without a pluralisation library. */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${word}`;
}

/**
 * True when a raw value is a safe integer for `Number` conversion.
 * Guards the few places where a count must become a JS number.
 */
export function isSafeIntegerValue(value: bigint): boolean {
  return (
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    value >= BigInt(Number.MIN_SAFE_INTEGER)
  );
}

/** Converts a count to `number`, refusing silently-lossy conversions. */
export function toSafeNumber(value: bigint): number {
  if (!isSafeIntegerValue(value)) {
    throw new RangeError(
      `Value ${value.toString(10)} exceeds the safe integer range for display`,
    );
  }
  return Number(value);
}
