import type { GovernanceConfig, RecognizedOrUnrecognized } from "./types";

/**
 * Participation eligibility, derived from protocol configuration.
 *
 * GovLayerCore decides eligibility inside the write itself (and fails closed),
 * so nothing here is authoritative: it exists to tell a person what the protocol
 * will check *before* they attempt an action. Three outcomes are kept strictly
 * apart (Blueprint section 12):
 *
 *   - `eligible`        -- every requirement that could be read was satisfied;
 *   - `not_eligible`    -- a requirement was read and is definitively unmet;
 *   - `unverifiable`    -- a requirement could not be read. Never reported as
 *                          ineligible, and never presented as a green light.
 *
 * The whitelist requirement is independent of the eligibility mode: a DAO can
 * combine both. Token requirements follow the contract's own interfaces --
 * `balance_of` for ERC20 (including the `custom` mode, which only accepts an
 * ERC20-shaped interface) and `balanceOf` for NFT ownership counts.
 */

export type EligibilityStatus = "eligible" | "not_eligible" | "unverifiable";

export type EligibilityAction = "vote" | "propose";

export interface TokenRequirement {
  readonly tokenAddress: string;
  readonly minimum: bigint;
  /** Protocol-defined method name, matching the contract's own interface. */
  readonly method: "balance_of" | "balanceOf";
  readonly label: string;
}

export interface EligibilityInput {
  readonly config: GovernanceConfig;
  readonly action: EligibilityAction;
  readonly address: string;
  /** Whitelist membership, or null when it could not be read. */
  readonly whitelisted: boolean | null;
  /** Token balance, or null when it could not be read or was not required. */
  readonly tokenBalance: bigint | null;
}

export interface EligibilityResult {
  readonly status: EligibilityStatus;
  /** One sentence stating the outcome, suitable for display as-is. */
  readonly summary: string;
  /** What the protocol requires, listed regardless of outcome. */
  readonly requirements: readonly string[];
  /** What could not be read, when the outcome is `unverifiable`. */
  readonly unreadRequirements: readonly string[];
}

/** Whether the configured mode gates participation on a token balance. */
export function tokenRequirementFor(
  config: GovernanceConfig,
  action: EligibilityAction,
): TokenRequirement | null {
  const mode: RecognizedOrUnrecognized<string> = config.eligibilityMode;
  const minimum =
    action === "vote" ? config.minTokensToVote : config.minTokensToPropose;

  if (mode === "open") return null;

  if (mode === "erc20" || mode === "custom") {
    return {
      tokenAddress: config.votingToken,
      minimum,
      method: "balance_of",
      label:
        action === "vote"
          ? "an ERC20 voting balance"
          : "an ERC20 balance to propose",
    };
  }

  if (mode === "nft") {
    return {
      tokenAddress: config.votingToken,
      minimum,
      method: "balanceOf",
      label: "governance NFT ownership",
    };
  }

  // An unrecognised mode means this interface cannot describe the requirement.
  // Returning null would silently drop it, so `evaluateEligibility` reports the
  // unrecognised mode as unverifiable instead.
  return null;
}

/** Whether whitelist membership is part of the requirement for this action. */
export function requiresWhitelist(
  config: GovernanceConfig,
  action: EligibilityAction,
): boolean {
  return action === "vote"
    ? config.useWhitelistForVoting
    : config.useWhitelistForProposing;
}

/**
 * The address a token requirement must be read from, or null when the DAO has
 * no token configured. The contract treats an unconfigured token as a
 * fail-closed zero balance, which is stated rather than hidden.
 */
export function tokenAddressFor(
  config: GovernanceConfig,
  action: EligibilityAction,
): string | null {
  const requirement = tokenRequirementFor(config, action);
  if (requirement === null) return null;
  return isZeroAddress(requirement.tokenAddress)
    ? null
    : requirement.tokenAddress;
}

/**
 * Whether configuration alone determines a zero balance, so no read is needed.
 *
 * GovLayerCore's balance helper returns 0 -- fail closed, never open -- for a
 * zero token address, and for a `custom` mode whose `custom_token_interface_kind`
 * is not one it implements (the contract accepts exactly one: "erc20"). Both are
 * deterministic configuration checks rather than external-call failures, so the
 * outcome is a definite "not eligible" and must not be reported as a read that
 * could not be verified.
 */
export function tokenConfigurationDeterminesZero(
  config: GovernanceConfig,
  action: EligibilityAction,
): boolean {
  const requirement = tokenRequirementFor(config, action);
  if (requirement === null) return false;

  if (isZeroAddress(requirement.tokenAddress)) return true;

  return (
    config.eligibilityMode === "custom" &&
    config.customTokenInterfaceKind !== "erc20"
  );
}

export function isZeroAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address);
}


export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const { config, action, whitelisted, tokenBalance } = input;

  const requirements: string[] = [];
  const unread: string[] = [];

  const modeIsRecognised =
    config.eligibilityMode === "open" ||
    config.eligibilityMode === "erc20" ||
    config.eligibilityMode === "nft" ||
    config.eligibilityMode === "custom";

  const needsWhitelist = requiresWhitelist(config, action);
  const requirement = tokenRequirementFor(config, action);
  const needsToken = requirement !== null;
  const zeroByConfiguration = tokenConfigurationDeterminesZero(config, action);
  const zeroBecauseAddress =
    requirement !== null && isZeroAddress(requirement.tokenAddress);

  if (needsWhitelist) {
    requirements.push(
      action === "vote"
        ? "This address must be on the voter whitelist."
        : "This address must be on the proposer whitelist.",
    );
  }

  if (requirement !== null) {
    requirements.push(
      `A ${requirement.label} of at least ${requirement.minimum.toString()}.`,
    );
  }

  if (config.votingWeightMode === "token_weighted" && action === "vote") {
    requirements.push(
      "Voting weight is the address's token balance at the moment of voting.",
    );
  }

  if (!modeIsRecognised) {
    unread.push(
      `The DAO's participation mode is recorded as "${String(
        config.eligibilityMode,
      )}", which this interface does not recognise.`,
    );
  }

  if (needsWhitelist && whitelisted === null) {
    unread.push("Whitelist membership could not be read.");
  }

  if (zeroByConfiguration) {
    // GovLayerCore reads both cases as a zero balance, deterministically and fail
    // closed, so this is a definite outcome rather than a failed read.
    return {
      status: "not_eligible",
      summary: zeroBecauseAddress
        ? "This DAO requires a token balance, but no token is configured for it. The contract reads that as a zero balance and will refuse this action."
        : `This DAO selects a custom token interface recorded as "${config.customTokenInterfaceKind}", which the contract does not implement. It reads that configuration as a zero balance and will refuse this action.`,
      requirements,
      unreadRequirements: unread,
    };
  }

  if (needsToken && tokenBalance === null) {
    unread.push("The token balance required by this DAO could not be read.");
  }

  if (needsWhitelist && whitelisted === false) {
    return {
      status: "not_eligible",
      summary:
        action === "vote"
          ? "This address is not on the voter whitelist, so the contract will refuse a vote."
          : "This address is not on the proposer whitelist, so the contract will refuse a proposal.",
      requirements,
      unreadRequirements: unread,
    };
  }

  if (requirement !== null && tokenBalance !== null) {
    if (tokenBalance < requirement.minimum) {
      return {
        status: "not_eligible",
        summary: `This address holds ${tokenBalance.toString()}, below the required ${requirement.minimum.toString()}, so the contract will refuse this action.`,
        requirements,
        unreadRequirements: unread,
      };
    }
  }

  if (unread.length > 0) {
    return {
      status: "unverifiable",
      summary:
        "Eligibility could not be fully verified right now. This is not a negative result: the protocol decides eligibility when the action is attempted.",
      requirements,
      unreadRequirements: unread,
    };
  }

  return {
    status: "eligible",
    summary:
      requirements.length === 0
        ? "This DAO's configuration places no eligibility requirement on this action: any address may take part."
        : "Every requirement this interface can read is satisfied. The protocol makes the final decision when the action is attempted.",
    requirements,
    unreadRequirements: [],
  };
}

/** Human label for an eligibility mode, or the raw value if unrecognised. */
export function eligibilityModeLabel(
  mode: RecognizedOrUnrecognized<string>,
): string {
  if (mode === "open") return "Open";
  if (mode === "erc20") return "ERC20 token holders";
  if (mode === "nft") return "Governance NFT holders";
  if (mode === "custom") return "Custom token interface";
  return mode;
}

