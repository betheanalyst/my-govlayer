/**
 * Hex value types and guards.
 *
 * These are structural equivalents of the SDK's own address/hash types, so no
 * direct dependency on viem (or any other blockchain library) is introduced --
 * the Foundation Standard designates genlayer-js as the sole gateway.
 */

export type HexAddress = `0x${string}`;

export type TransactionHash = `0x${string}` & { readonly length: 66 };

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function isHexAddress(value: unknown): value is HexAddress {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function asHexAddress(value: string): HexAddress {
  if (!isHexAddress(value)) {
    throw new TypeError(`Not a valid 20-byte hex address: ${JSON.stringify(value)}`);
  }
  return value as HexAddress;
}

export function isTransactionHash(value: unknown): value is TransactionHash {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

export function asTransactionHash(value: unknown): TransactionHash {
  if (!isTransactionHash(value)) {
    throw new TypeError(
      `Not a valid 32-byte transaction hash: ${JSON.stringify(value)}`,
    );
  }
  return value as TransactionHash;
}

/** Lowercased form, used whenever comparing addresses for equality. */
export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function addressesEqual(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

/**
 * Shortened address for secondary display only. Full values must remain
 * available wherever a user could need to verify them.
 */
export function shortenAddress(value: string, lead = 6, tail = 4): string {
  const trimmed = value.trim();
  if (trimmed.length <= lead + tail + 2) return trimmed;
  return `${trimmed.slice(0, lead)}…${trimmed.slice(-tail)}`;
}
