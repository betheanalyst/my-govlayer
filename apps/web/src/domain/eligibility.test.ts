import { describe, expect, it } from "vitest";
import { evaluateEligibility, tokenRequirementFor } from "./eligibility";
import { makeConfig } from "./testFactories";

/**
 * Eligibility is derived state, so what matters is that the three outcomes stay
 * distinct: a requirement that was read and unmet is not the same as a
 * requirement that could not be read (Blueprint section 12).
 */

const ADDRESS = "0x1111111111111111111111111111111111111111";

describe("tokenRequirementFor", () => {
  it("requires nothing in open mode", () => {
    expect(tokenRequirementFor(makeConfig({ eligibilityMode: "open" }), "vote")).toBeNull();
  });

  it("uses the contract's own ERC20 method for erc20 mode", () => {
    const requirement = tokenRequirementFor(
      makeConfig({
        eligibilityMode: "erc20",
        votingToken: "0x3333333333333333333333333333333333333333",
        minTokensToVote: 10n,
      }),
      "vote",
    );
    expect(requirement?.method).toBe("balance_of");
    expect(requirement?.minimum).toBe(10n);
  });

  it("uses the contract's ERC721 method for nft mode", () => {
    const requirement = tokenRequirementFor(
      makeConfig({
        eligibilityMode: "nft",
        votingToken: "0x3333333333333333333333333333333333333333",
      }),
      "vote",
    );
    expect(requirement?.method).toBe("balanceOf");
  });

  it("treats custom mode as ERC20 only when the interface kind says so", () => {
    const erc20 = tokenRequirementFor(
      makeConfig({ eligibilityMode: "custom", customTokenInterfaceKind: "erc20" }),
      "vote",
    );
    expect(erc20?.method).toBe("balance_of");
  });

  it("reports an unimplemented custom interface kind as definitely zero, not unreadable", () => {
    // GovLayerCore implements exactly one custom kind ("erc20"); for anything
    // else its balance helper returns 0 deterministically, so eligibility is a
    // definite "not eligible" rather than a failed read.
    const result = evaluateEligibility({
      config: makeConfig({
        eligibilityMode: "custom",
        customTokenInterfaceKind: "erc1155",
        votingToken: "0x3333333333333333333333333333333333333333",
      }),
      action: "vote",
      address: ADDRESS,
      whitelisted: true,
      tokenBalance: null,
    });
    expect(result.status).toBe("not_eligible");
    expect(result.summary).toContain("erc1155");
  });
});

describe("evaluateEligibility", () => {
  it("reports an open DAO as having no requirement", () => {
    const result = evaluateEligibility({
      config: makeConfig({ eligibilityMode: "open" }),
      action: "vote",
      address: ADDRESS,
      whitelisted: true,
      tokenBalance: null,
    });
    expect(result.status).toBe("eligible");
    expect(result.requirements).toHaveLength(0);
  });

  it("reports a definitely unmet requirement as not eligible", () => {
    const result = evaluateEligibility({
      config: makeConfig({
        useWhitelistForVoting: true,
        eligibilityMode: "open",
      }),
      action: "vote",
      address: ADDRESS,
      whitelisted: false,
      tokenBalance: null,
    });
    expect(result.status).toBe("not_eligible");
    expect(result.summary).toContain("not on the voter whitelist");
  });

  it("never turns a failed read into ineligibility", () => {
    const result = evaluateEligibility({
      config: makeConfig({
        useWhitelistForVoting: true,
        eligibilityMode: "open",
      }),
      action: "vote",
      address: ADDRESS,
      whitelisted: null,
      tokenBalance: null,
    });
    expect(result.status).toBe("unverifiable");
    expect(result.summary).toContain("not a negative result");
  });

  it("reports a balance below the minimum as not eligible", () => {
    const result = evaluateEligibility({
      config: makeConfig({
        eligibilityMode: "erc20",
        votingToken: "0x3333333333333333333333333333333333333333",
        minTokensToVote: 100n,
      }),
      action: "vote",
      address: ADDRESS,
      whitelisted: true,
      tokenBalance: 99n,
    });
    expect(result.status).toBe("not_eligible");
    expect(result.summary).toContain("99");
  });

  it("states an unconfigured token as the contract's fail-closed zero balance", () => {
    const result = evaluateEligibility({
      config: makeConfig({
        eligibilityMode: "erc20",
        votingToken: "0x0000000000000000000000000000000000000000",
      }),
      action: "vote",
      address: ADDRESS,
      whitelisted: true,
      tokenBalance: null,
    });
    expect(result.status).toBe("not_eligible");
    expect(result.summary).toContain("no token is configured");
  });

  it("marks an unrecognised participation mode as unverifiable", () => {
    const result = evaluateEligibility({
      config: makeConfig({ eligibilityMode: "unrecognized" }),
      action: "propose",
      address: ADDRESS,
      whitelisted: true,
      tokenBalance: null,
    });
    expect(result.status).toBe("unverifiable");
    expect(result.unreadRequirements).toHaveLength(1);
  });

  it("mentions token-weighted weight only when the mode is weighted", () => {
    const weighted = evaluateEligibility({
      config: makeConfig({ eligibilityMode: "open", votingWeightMode: "token_weighted" }),
      action: "vote",
      address: ADDRESS,
      whitelisted: true,
      tokenBalance: null,
    });
    const equal = evaluateEligibility({
      config: makeConfig({ eligibilityMode: "open", votingWeightMode: "equal" }),
      action: "vote",
      address: ADDRESS,
      whitelisted: true,
      tokenBalance: null,
    });
    expect(weighted.requirements.join(" ")).toContain("Voting weight");
    expect(equal.requirements.join(" ")).not.toContain("Voting weight");
  });
});
