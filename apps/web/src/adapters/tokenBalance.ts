import {
  getDefaultConnection,
  readContractView,
  type ResolvedConnection,
} from "./client";
import { AppError, extractMessage } from "@/lib/errors";

/**
 * External token balance reads.
 *
 * This is the one place the frontend reads a contract other than GovLayerCore
 * or GovLayerAdmin: participation eligibility can depend on a token balance, and
 * the token lives elsewhere. The method names are not invented -- they mirror
 * the interfaces GovLayerCore itself declares and calls
 * (`ERC20BalanceInterface.balance_of`, `ERC721OwnershipInterface.balanceOf`), so
 * what this interface displays is exactly what the contract will evaluate.
 *
 * A read that fails is reported as verification uncertainty. It is never
 * reported as "no balance", because that would turn a failure into an
 * eligibility judgement (Blueprint section 12).
 */

export type TokenInterfaceKind = "balance_of" | "balanceOf";

/**
 * Chooses the read method from protocol configuration.
 * Returns null when the configured mode implies no token requirement, or when
 * the interface kind is one this frontend does not recognise -- in which case
 * nothing is guessed and the caller reports what it cannot verify.
 */
export function tokenMethodFor(input: {
  readonly eligibilityMode: string;
  readonly customTokenInterfaceKind: string;
}): TokenInterfaceKind | null {
  if (input.eligibilityMode === "erc20") return "balance_of";
  if (input.eligibilityMode === "nft") return "balanceOf";
  if (input.eligibilityMode === "custom") {
    // GovLayerCore accepts exactly one custom kind today ("erc20"). Any other
    // value is already a deterministically-zero balance configuration, so it is
    // reported as ineligible by `evaluateEligibility` without a read. Returning
    // null here means "no read is defined"; it never means "unverifiable".
    return input.customTokenInterfaceKind === "erc20" ? "balance_of" : null;
  }
  return null;
}

export interface TokenBalanceRequest {
  readonly tokenAddress: string;
  readonly owner: string;
  readonly method: TokenInterfaceKind;
}

export function tokenBalanceUnavailable(reason: string, cause?: unknown): AppError {
  return new AppError({
    kind: "verification_uncertainty",
    message: `The token balance required for eligibility could not be verified (${reason}).`,
    nextStep:
      "This is not an eligibility result. Retry in a moment; the protocol decides eligibility when the action is attempted.",
    recoverable: true,
    raw: cause === undefined ? undefined : extractMessage(cause),
    cause,
  });
}

/**
 * Reads a token balance through genlayer-js. The returned value stays a bigint:
 * balances are on-chain integers and are never narrowed to a JS number.
 */
export async function readTokenBalance(
  request: TokenBalanceRequest,
  connection: ResolvedConnection = getDefaultConnection(),
): Promise<bigint> {
  const raw = await readContractView(
    {
      address: request.tokenAddress,
      functionName: request.method,
      args: [request.owner],
    },
    connection,
  );

  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isInteger(raw)) return BigInt(raw);
  if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);

  throw tokenBalanceUnavailable(
    "the token contract returned a value this interface does not recognise as a balance",
    raw,
  );
}
