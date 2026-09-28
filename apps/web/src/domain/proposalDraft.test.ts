import { describe, expect, it } from "vitest";
import { parseVotingDuration, toSubmitInput, validateProposalDraft } from "./proposalDraft";
import { makeConfig } from "./testFactories";

/**
 * These rules mirror `submit_proposal`'s own checks. They exist to catch mistakes
 * before a wallet is asked to sign; the contract remains authoritative, so the
 * tests assert the mirror rather than treating it as the source of truth.
 */

const config = makeConfig({
  minVotingDuration: 3_600,
  maxVotingDuration: 2_592_000,
});

const valid = {
  title: "Renew the grants programme",
  description: "A description of substance.",
  proposalType: "standard" as const,
  proposedConstitution: "",
  votingDurationSeconds: "86400",
};

describe("validateProposalDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateProposalDraft(valid, config)).toHaveLength(0);
  });

  it("requires non-empty title and description, as the contract does", () => {
    const issues = validateProposalDraft(
      { ...valid, title: "   ", description: "" },
      config,
    );
    expect(issues.map((issue) => issue.field)).toEqual(["title", "description"]);
  });

  it("enforces the contract's length limits", () => {
    const issues = validateProposalDraft(
      { ...valid, title: "t".repeat(201), description: "d".repeat(5001) },
      config,
    );
    expect(issues.map((issue) => issue.field)).toEqual(["title", "description"]);
  });

  it("requires constitution text for an amendment", () => {
    const issues = validateProposalDraft(
      { ...valid, proposalType: "constitution" },
      config,
    );
    expect(issues[0]?.field).toBe("proposedConstitution");
  });

  it("rejects a duration outside the configured bounds", () => {
    const tooShort = validateProposalDraft(
      { ...valid, votingDurationSeconds: "3599" },
      config,
    );
    const tooLong = validateProposalDraft(
      { ...valid, votingDurationSeconds: "2592001" },
      config,
    );
    expect(tooShort[0]?.field).toBe("votingDurationSeconds");
    expect(tooLong[0]?.field).toBe("votingDurationSeconds");
  });

  it("rejects a non-numeric or zero duration rather than rounding it", () => {
    expect(parseVotingDuration("90s")).toBeNull();
    expect(parseVotingDuration("")).toBeNull();
    const issues = validateProposalDraft({ ...valid, votingDurationSeconds: "0" }, config);
    expect(issues[0]?.message).toContain("cannot be zero");
  });

  it("keeps the duration exact as a bigint", () => {
    expect(parseVotingDuration("86400")).toBe(86400n);
    expect(toSubmitInput(valid).votingDuration).toBe(86400n);
  });

  it("omits the amendment field for a standard proposal", () => {
    expect("proposedConstitution" in toSubmitInput(valid)).toBe(false);
  });
});
