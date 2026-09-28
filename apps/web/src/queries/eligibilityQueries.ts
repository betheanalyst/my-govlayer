"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { readTokenBalance, tokenMethodFor } from "@/adapters/tokenBalance";
import {
  evaluateEligibility,
  requiresWhitelist,
  tokenAddressFor,
  type EligibilityAction,
  type EligibilityResult,
} from "@/domain/eligibility";
import type { GovernanceConfig } from "@/domain/types";
import { useWallet } from "@/wallet/WalletProvider";
import { coreAdapter, governanceConfigQuery } from "./coreQueries";
import { queryKeys } from "./keys";
import { STALE_TIME } from "./policy";

/**
 * Eligibility queries.
 *
 * These reads exist only to tell a person what the protocol will check before
 * they attempt an action, so they run only when a wallet is connected. A read
 * that fails produces `unverifiable`, never `not_eligible`.
 */

export function whitelistMembershipQuery(
  kind: "voter" | "proposer",
  address: string,
  enabled = true,
) {
  return queryOptions<boolean>({
    queryKey: queryKeys.core.whitelistMembership(kind, address),
    queryFn: async () => {
      const adapter = coreAdapter();
      return kind === "voter"
        ? adapter.isVoterWhitelisted(address)
        : adapter.isProposerWhitelisted(address);
    },
    staleTime: STALE_TIME.config,
    enabled,
  });
}

export function tokenBalanceQuery(
  config: GovernanceConfig | undefined,
  action: EligibilityAction,
  address: string,
) {
  const tokenAddress =
    config === undefined ? null : tokenAddressFor(config, action);
  const method =
    config === undefined
      ? null
      : tokenMethodFor({
          eligibilityMode: String(config.eligibilityMode),
          customTokenInterfaceKind: config.customTokenInterfaceKind,
        });

  const enabled = tokenAddress !== null && method !== null;

  return queryOptions<bigint>({
    queryKey: [...queryKeys.core.all, "token-balance", action, tokenAddress ?? "none", address.toLowerCase()],
    queryFn: () => {
      if (tokenAddress === null || method === null) {
        throw new Error("no token requirement is configured for this action");
      }
      return readTokenBalance({ tokenAddress, owner: address, method });
    },
    staleTime: STALE_TIME.config,
    enabled,
  });
}

export interface EligibilityState {
  readonly result: EligibilityResult | null;
  readonly isLoading: boolean;
  /** Set when the configuration itself could not be read. */
  readonly configError: unknown;
}

export function useEligibility(action: EligibilityAction): EligibilityState {
  const wallet = useWallet();
  const address = wallet.address;

  const configQuery = useQuery(governanceConfigQuery());
  const config = configQuery.data;

  const needsWhitelist = config !== undefined && requiresWhitelist(config, action);

  const whitelistQuery = useQuery(
    whitelistMembershipQuery(
      action === "vote" ? "voter" : "proposer",
      address ?? "",
      address !== null && needsWhitelist,
    ),
  );

  const balanceQuery = useQuery(tokenBalanceQuery(config, action, address ?? ""));

  if (config === undefined || address === null) {
    return {
      result: null,
      isLoading: configQuery.isLoading,
      configError: configQuery.error,
    };
  }

  // Only requirements that were actually attempted contribute a value; anything
  // else stays null, which the evaluator reports as unread rather than unmet.
  const whitelisted = needsWhitelist
    ? (whitelistQuery.data ?? null)
    : true;

  const tokenRequired = tokenAddressFor(config, action) !== null;
  const tokenBalance = tokenRequired ? (balanceQuery.data ?? null) : null;

  const result = evaluateEligibility({
    config,
    action,
    address,
    whitelisted,
    tokenBalance,
  });

  return {
    result,
    isLoading:
      configQuery.isLoading ||
      (needsWhitelist && whitelistQuery.isLoading) ||
      (tokenRequired && balanceQuery.isLoading),
    configError: configQuery.error,
  };
}
