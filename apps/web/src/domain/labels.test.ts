import { describe, expect, it } from "vitest";
import {
  proposalStageLabel,
  proposalStageTone,
  adminActionStageLabel,
  proposalStatusTone,
} from "./labels";
import type { ProposalStage } from "./state";

/**
 * Experience Blueprint section 29 is explicit that `rejected`, `failed`,
 * `cancelled` and `needs_revision` are different protocol states and must not be
 * rendered as interchangeable generic badges. This guards the two things that
 * make them distinguishable: distinct wording, and distinct visual tone families.
 */

describe("proposal stage presentation", () => {
  it("gives every stage its own wording", () => {
    const stages: ProposalStage[] = [
      "review_rejected",
      "needs_revision",
      "voting_open",
      "voting_closed_awaiting_finalization",
      "dispute_reevaluation",
      "awaiting_stewardship_confirmation",
      "passed",
      "failed",
      "cancelled",
      "unrecognized",
    ];

    const labels = stages.map((stage) => proposalStageLabel(stage));
    expect(new Set(labels).size).toBe(stages.length);
  });

  it("keeps a review rejection and a failed vote in separate tone families", () => {
    expect(proposalStageTone("review_rejected")).toBe("review-negative");
    expect(proposalStageTone("failed")).toBe("determination-negative");
    expect(proposalStageTone("review_rejected")).not.toBe(
      proposalStageTone("failed"),
    );
  });

  it("does not reuse one tone across the four states the Blueprint singles out", () => {
    const tones = (
      ["review_rejected", "failed", "cancelled", "needs_revision"] as ProposalStage[]
    ).map((stage) => proposalStageTone(stage));

    expect(new Set(tones).size).toBe(4);
  });
});

describe("stewardship stage presentation", () => {
  it("distinguishes every stage a steward can act on", () => {
    const labels = (
      [
        "awaiting_approvals",
        "awaiting_timelock",
        "ready_to_execute",
        "executed",
        "expired",
      ] as const
    ).map((stage) => adminActionStageLabel(stage));

    expect(new Set(labels).size).toBe(5);
    expect(labels).toContain("Ready to execute");
    expect(labels).toContain("Executed (authorized)");
  });
});

describe("proposal status presentation", () => {
  it("keeps rejected and failed distinct at the status level too", () => {
    expect(proposalStatusTone("rejected")).not.toBe(proposalStatusTone("failed"));
  });
});
