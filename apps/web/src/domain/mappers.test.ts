import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  toAdminSnapshot,
  toGovernanceConfig,
  toList,
  toProposal,
} from "./mappers";
import { UNRECOGNIZED } from "./types";

function baseProposal(overrides: Record<string, unknown> = {}): unknown {
  return {
    proposal_id: 1,
    proposer: "0x1111111111111111111111111111111111111111",
    proposal_type: "standard",
    title: "A proposal",
    description: "Body",
    proposed_constitution: "",
    constitution_snapshot: "Constitution text at submission",
    status: "pending",
    failure_reason: "",
    ai_audit_decision: "accept",
    ai_audit_reasoning: "Looks compliant.",
    constitutional_conflicts: [],
    resubmission_count: 0,
    votes_yes: 0,
    votes_no: 0,
    created_at: 1_700_000_000,
    voting_closes_at: 1_700_003_600,
    dispute_stage: 0,
    dispute_history: [],
    ...overrides,
  };
}

describe("toProposal", () => {
  it("keeps counts exact and converts timestamps to numbers", () => {
    const proposal = toProposal(
      baseProposal({ votes_yes: "42", votes_no: 1n, created_at: 1_700_000_000 }),
    );

    expect(proposal.votesYes).toBe(42n);
    expect(proposal.votesNo).toBe(1n);
    expect(typeof proposal.votesYes).toBe("bigint");
    expect(proposal.createdAt).toBe(1_700_000_000);
    expect(proposal.votingClosesAt).toBe(1_700_003_600);
  });

  it("preserves an unrecognised status instead of coercing it", () => {
    const proposal = toProposal(baseProposal({ status: "vetoed" }));

    expect(proposal.status).toBe(UNRECOGNIZED);
    expect(proposal.rawStatus).toBe("vetoed");
  });

  it("maps conflicts and dispute history", () => {
    const proposal = toProposal(
      baseProposal({
        constitutional_conflicts: [
          { description: "Contradicts clause 4", severity: "high" },
        ],
        dispute_history: [
          {
            stage: 1,
            raised_by: "0x2222222222222222222222222222222222222222",
            raised_at: 1_700_001_000,
            resolution: "accept",
            reasoning: "Re-evaluated.",
          },
        ],
        dispute_stage: 1,
      }),
    );

    expect(proposal.conflicts).toHaveLength(1);
    expect(proposal.conflicts[0]?.severity).toBe("high");
    expect(proposal.disputeHistory[0]?.stage).toBe(1);
    expect(proposal.disputeHistory[0]?.resolution).toBe("accept");
  });

  it("refuses an unreadable record rather than rendering blanks", () => {
    expect(() => toProposal({})).toThrowError(AppError);
    expect(() => toProposal(baseProposal({ proposal_id: "not-a-number" }))).toThrowError(
      AppError,
    );
  });
});

describe("toGovernanceConfig", () => {
  const raw = {
    admin_contract_address: "0xf85b2e784c984Dc456C2827e321cC7C26320df84",
    constitution_version: 1,
    eligibility_mode: "open",
    voting_weight_mode: "equal",
    voting_token: "0x0000000000000000000000000000000000000000",
    custom_token_interface_kind: "",
    min_tokens_to_vote: 0,
    min_tokens_to_propose: 0,
    use_whitelist_for_voting: false,
    use_whitelist_for_proposing: false,
    min_quorum: 3,
    approval_threshold_percent: 60,
    min_voting_duration: 3600,
    max_voting_duration: 2_592_000,
    max_resubmissions: 3,
    dispute_cooldown_seconds: 3600,
    max_dispute_stages_count: 3,
    max_proposals_per_window: 7,
    proposal_rate_window_secs: 604_800,
    proposal_count: 12,
    governance_history_count: 30,
  };

  it("reads the complete configuration with exact counts", () => {
    const config = toGovernanceConfig(raw);

    expect(config.eligibilityMode).toBe("open");
    expect(config.votingWeightMode).toBe("equal");
    expect(config.minQuorum).toBe(3n);
    expect(config.proposalCount).toBe(12n);
    expect(config.minVotingDuration).toBe(3600);
    expect(config.useWhitelistForVoting).toBe(false);
  });

  it("keeps an unrecognised voting weight mode visible", () => {
    const config = toGovernanceConfig({ ...raw, voting_weight_mode: "quadratic" });
    expect(config.votingWeightMode).toBe(UNRECOGNIZED);
  });

  it("requires booleans to actually be booleans", () => {
    expect(() =>
      toGovernanceConfig({ ...raw, use_whitelist_for_voting: "false" }),
    ).toThrowError(AppError);
  });
});

describe("toAdminSnapshot", () => {
  it("composes the separate admin reads into one snapshot", () => {
    const snapshot = toAdminSnapshot({
      admins: ["0xaaa", "0xbbb"],
      activeAdminCount: 2,
      bootstrapComplete: false,
      currentThreshold: 2,
      paused: false,
    });

    expect(snapshot.admins).toEqual(["0xaaa", "0xbbb"]);
    expect(snapshot.activeAdminCount).toBe(2);
    expect(snapshot.bootstrapComplete).toBe(false);
    expect(snapshot.paused).toBe(false);
  });
});

describe("toList", () => {
  const identity = (entry: unknown) => entry;

  it("treats an empty or absent response as an empty list", () => {
    expect(toList(null, identity, "test")).toEqual([]);
    expect(toList(undefined, identity, "test")).toEqual([]);
    expect(toList("0x", identity, "test")).toEqual([]);
    expect(toList([], identity, "test")).toEqual([]);
  });

  it("maps every entry in order", () => {
    expect(toList([1, 2, 3], (entry) => Number(entry) * 2, "test")).toEqual([2, 4, 6]);
  });

  it("throws when the response is not a list", () => {
    expect(() => toList({ nope: true }, identity, "test")).toThrowError(AppError);
  });
});
