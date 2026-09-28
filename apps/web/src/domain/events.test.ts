import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_EVENT_TYPES,
  classifyGovernanceEventType,
  governanceEventLabel,
  indexAppliedActions,
  indexPullRejections,
  parseAdminActionAppliedDetails,
  parseConstitutionAppliedDetails,
  parseProposalCreatedDetails,
  parsePullRejectedDetails,
} from "./events";
import { makeEvent } from "./testFactories";

describe("classifyGovernanceEventType", () => {
  it("recognizes every event type the contracts record", () => {
    for (const type of GOVERNANCE_EVENT_TYPES) {
      expect(classifyGovernanceEventType(type)).toBe(type);
    }
  });

  it("surfaces an unknown event type rather than renaming it", () => {
    const label = governanceEventLabel("some_future_event");
    expect(label).toBe("some_future_event");
  });
});

describe("parseAdminActionAppliedDetails", () => {
  it("parses the uniform action/type/fields layout", () => {
    const parsed = parseAdminActionAppliedDetails(
      "action:ACTION-00000003|type:set_voting_parameters|min_quorum=3,approval_threshold_percent=60,min_voting_duration=3600,max_voting_duration=2592000",
    );

    expect(parsed?.actionId).toBe("ACTION-00000003");
    expect(parsed?.actionType).toBe("set_voting_parameters");
    expect(parsed?.fields.min_quorum).toBe("3");
    expect(parsed?.fields.approval_threshold_percent).toBe("60");
  });

  it("parses a whitelist batch summary", () => {
    const parsed = parseAdminActionAppliedDetails(
      "action:ACTION-00000007|type:update_whitelist|target=voter,added=3,removed=1",
    );

    expect(parsed?.actionType).toBe("update_whitelist");
    expect(parsed?.fields.target).toBe("voter");
    expect(parsed?.fields.added).toBe("3");
  });

  it("returns null for a layout it does not recognise", () => {
    expect(parseAdminActionAppliedDetails("some free text")).toBeNull();
    expect(parseAdminActionAppliedDetails("type:set_voting_parameters")).toBeNull();
  });
});

describe("parsePullRejectedDetails", () => {
  it("parses the rejection record, keeping the reason verbatim", () => {
    const parsed = parsePullRejectedDetails(
      "action_id:ACTION-00000005|action_type:set_voting_parameters|reason:malformed or out-of-range voting-parameters payload",
    );

    expect(parsed?.actionId).toBe("ACTION-00000005");
    expect(parsed?.actionType).toBe("set_voting_parameters");
    expect(parsed?.reason).toBe("malformed or out-of-range voting-parameters payload");
  });

  it("returns null when the record is not a rejection", () => {
    expect(parsePullRejectedDetails("nonsense")).toBeNull();
  });
});

describe("parseProposalCreatedDetails", () => {
  it("reads the recorded submission facts", () => {
    const parsed = parseProposalCreatedDetails(
      "Proposal #12 (type:constitution ai:revise status:needs_revision closes:1700003600)",
    );

    expect(parsed?.proposalId).toBe(12n);
    expect(parsed?.proposalType).toBe("constitution");
    expect(parsed?.auditDecision).toBe("revise");
    expect(parsed?.initialStatus).toBe("needs_revision");
    expect(parsed?.votingClosesAt).toBe(1_700_003_600);
  });

  it("returns null for unrelated details", () => {
    expect(parseProposalCreatedDetails("nothing to see")).toBeNull();
  });
});

describe("parseConstitutionAppliedDetails", () => {
  it("reads the version, authorizing action, and proposal", () => {
    const parsed = parseConstitutionAppliedDetails(
      "Constitution updated to version 2 via action ACTION-00000004, proposal #3",
    );

    expect(parsed?.version).toBe(2n);
    expect(parsed?.actionId).toBe("ACTION-00000004");
    expect(parsed?.proposalId).toBe(3n);
  });
});

describe("history indexes", () => {
  const events = [
    makeEvent({
      eventType: "proposal_created",
      details: "Proposal #1 (type:standard ai:accept status:pending closes:1700003600)",
    }),
    makeEvent({
      eventType: "admin_action_applied",
      timestamp: 1_700_001_000,
      details: "action:ACTION-00000002|type:set_eligibility_mode|eligibility_mode=erc20",
    }),
    makeEvent({
      eventType: "admin_action_pull_rejected",
      timestamp: 1_700_002_000,
      details:
        "action_id:ACTION-00000003|action_type:set_voting_parameters|reason:stale Core-side state",
    }),
  ];

  it("indexes applied actions by action id", () => {
    const applied = indexAppliedActions(events);
    expect(applied.get("ACTION-00000002")?.actionType).toBe("set_eligibility_mode");
    expect(applied.get("ACTION-00000002")?.timestamp).toBe(1_700_001_000);
    expect(applied.has("ACTION-00000003")).toBe(false);
  });

  it("indexes pull rejections by action id", () => {
    const rejected = indexPullRejections(events);
    expect(rejected.get("ACTION-00000003")?.reason).toBe("stale Core-side state");
    expect(rejected.has("ACTION-00000002")).toBe(false);
  });

  it("ignores entries it cannot parse instead of failing the whole feed", () => {
    const applied = indexAppliedActions([
      makeEvent({ eventType: "admin_action_applied", details: "unparsable" }),
    ]);
    expect(applied.size).toBe(0);
  });
});
