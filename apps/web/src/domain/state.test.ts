import { describe, expect, it } from "vitest";
import {
  approvalProgress,
  approvalStatus,
  canCancel,
  canFinalize,
  canResubmit,
  canVote,
  deriveAdminActionStage,
  deriveApplicationState,
  deriveProposalStage,
  disputeCooldownRemaining,
  disputeEligibility,
  disputeStagesRemaining,
  isVotingClosed,
  isVotingOpen,
  quorumStatus,
  summarizeProposal,
  timelockRemaining,
  voteTallies,
} from "./state";
import {
  makeConfig,
  makePendingAction,
  makeProposal,
  TEST_ADDRESSES,
  TEST_TIME,
} from "./testFactories";

const NOW = TEST_TIME.base;
const BEFORE_CLOSE = NOW + 1_000;
const AFTER_CLOSE = NOW + 4_000;

describe("deriveProposalStage", () => {
  it("distinguishes open voting from closed-but-unfinalized voting", () => {
    const proposal = makeProposal({ status: "pending" });
    expect(deriveProposalStage(proposal, BEFORE_CLOSE)).toBe("voting_open");
    expect(deriveProposalStage(proposal, AFTER_CLOSE)).toBe(
      "voting_closed_awaiting_finalization",
    );
  });

  it("never describes a pending proposal as being under review", () => {
    // The initial audit runs inside the submission transaction, so `pending`
    // means the review already completed and voting is open.
    const stage = deriveProposalStage(makeProposal(), BEFORE_CLOSE);
    expect(stage).toBe("voting_open");
    expect(stage).not.toBe("dispute_reevaluation");
  });

  it("maps under_review to dispute reevaluation, not initial review", () => {
    expect(deriveProposalStage(makeProposal({ status: "under_review" }), NOW)).toBe(
      "dispute_reevaluation",
    );
  });

  it("keeps a review rejection and a post-vote failure in separate states", () => {
    expect(deriveProposalStage(makeProposal({ status: "rejected" }), NOW)).toBe(
      "review_rejected",
    );
    expect(deriveProposalStage(makeProposal({ status: "failed" }), NOW)).toBe("failed");
  });

  it("surfaces an unknown status instead of mapping it", () => {
    expect(
      deriveProposalStage(
        makeProposal({ status: "unrecognized", rawStatus: "vetoed" }),
        NOW,
      ),
    ).toBe("unrecognized");
  });
});

describe("voting window gates", () => {
  const proposal = makeProposal({ status: "pending" });

  it("keeps voting open through the deadline and closed after it", () => {
    expect(isVotingOpen(proposal, proposal.votingClosesAt)).toBe(true);
    expect(isVotingClosed(proposal, proposal.votingClosesAt)).toBe(false);
    expect(isVotingClosed(proposal, proposal.votingClosesAt + 1)).toBe(true);
  });

  it("allows finalization only once voting has closed", () => {
    expect(canFinalize(proposal, BEFORE_CLOSE)).toBe(false);
    expect(canFinalize(proposal, AFTER_CLOSE)).toBe(true);
  });

  it("does not allow voting on a determined proposal", () => {
    expect(canVote(makeProposal({ status: "passed" }), BEFORE_CLOSE)).toBe(false);
  });
});

describe("proposer capabilities", () => {
  it("blocks resubmission past the configured maximum", () => {
    const config = makeConfig({ maxResubmissions: 3n });
    expect(
      canResubmit(
        makeProposal({ status: "needs_revision", resubmissionCount: 2 }),
        config,
      ),
    ).toBe(true);
    expect(
      canResubmit(
        makeProposal({ status: "needs_revision", resubmissionCount: 3 }),
        config,
      ),
    ).toBe(false);
  });

  it("allows cancellation only before determination", () => {
    expect(canCancel(makeProposal({ status: "pending" }))).toBe(true);
    expect(canCancel(makeProposal({ status: "needs_revision" }))).toBe(true);
    expect(canCancel(makeProposal({ status: "passed" }))).toBe(false);
  });
});

describe("dispute eligibility", () => {
  const config = makeConfig({
    disputeCooldownSeconds: 3_600,
    maxDisputeStagesCount: 3n,
  });

  it("is not available for a post-vote failure", () => {
    expect(
      disputeEligibility(
        makeProposal({ status: "failed" }),
        config,
        TEST_ADDRESSES.proposer,
        NOW,
      ).state,
    ).toBe("not_rejected");
  });

  it("is available to the proposer of a rejected proposal", () => {
    expect(
      disputeEligibility(
        makeProposal({ status: "rejected" }),
        config,
        TEST_ADDRESSES.proposer,
        NOW,
      ).state,
    ).toBe("eligible_proposer");
  });

  it("reports a non-proposer as undetermined rather than assuming eligibility", () => {
    expect(
      disputeEligibility(
        makeProposal({ status: "rejected" }),
        config,
        TEST_ADDRESSES.other,
        NOW,
      ).state,
    ).toBe("undetermined_voter");
  });

  it("exhausts after the configured number of stages", () => {
    expect(
      disputeEligibility(
        makeProposal({ status: "rejected", disputeStage: 3 }),
        config,
        TEST_ADDRESSES.proposer,
        NOW,
      ).state,
    ).toBe("stages_exhausted");
  });

  it("applies the cooldown only between stages", () => {
    expect(
      disputeCooldownRemaining(makeProposal({ status: "rejected" }), config, NOW),
    ).toBeNull();

    const secondStage = makeProposal({
      status: "rejected",
      disputeStage: 1,
      disputeHistory: [
        {
          stage: 1,
          raisedBy: TEST_ADDRESSES.proposer,
          raisedAt: NOW - 600,
          resolution: "reject",
          reasoning: "Upheld.",
        },
      ],
    });

    expect(disputeCooldownRemaining(secondStage, config, NOW)).toBe(3_000);

    const result = disputeEligibility(
      secondStage,
      config,
      TEST_ADDRESSES.proposer,
      NOW,
    );
    expect(result.state).toBe("cooldown");
    if (result.state === "cooldown") {
      expect(result.remainingSeconds).toBe(3_000);
      expect(result.nextAllowedAt).toBe(NOW + 3_000);
    }
  });

  it("counts remaining stages from the contract counter", () => {
    expect(disputeStagesRemaining(makeProposal({ disputeStage: 1 }), config)).toBe(2);
    expect(disputeStagesRemaining(makeProposal({ disputeStage: 5 }), config)).toBe(0);
  });
});

describe("tallies, quorum and approval", () => {
  const config = makeConfig({ minQuorum: 3n, approvalThresholdPercent: 60n });

  it("counts votes when weight is equal", () => {
    const tallies = voteTallies(makeProposal({ votesYes: 4n, votesNo: 1n }), config);
    expect(tallies.recorded).toBe(5n);
    expect(tallies.weighted).toBe(false);
  });

  it("reports weight-based tallies when voting is token-weighted", () => {
    const tallies = voteTallies(
      makeProposal({ votesYes: 400n, votesNo: 100n }),
      makeConfig({ votingWeightMode: "token_weighted" }),
    );
    expect(tallies.recorded).toBe(500n);
    expect(tallies.weighted).toBe(true);
  });

  it("compares quorum against the recorded total", () => {
    expect(quorumStatus(makeProposal({ votesYes: 2n }), config).met).toBe(false);
    expect(
      quorumStatus(makeProposal({ votesYes: 2n, votesNo: 1n }), config).met,
    ).toBe(true);
  });

  it("uses the contract's own integer floor for the approval percentage", () => {
    const status = approvalStatus(makeProposal({ votesYes: 2n, votesNo: 1n }), config);
    expect(status.approvalPercent).toBe(66n);
    expect(status.met).toBe(true);
  });

  it("reports no percentage when nothing has been recorded", () => {
    const status = approvalStatus(makeProposal(), config);
    expect(status.approvalPercent).toBeNull();
    expect(status.met).toBe(false);
  });
});

describe("summarizeProposal", () => {
  const config = makeConfig();

  it("frames a review rejection as a review outcome, not a vote", () => {
    const summary = summarizeProposal(
      makeProposal({ status: "rejected" }),
      config,
      NOW,
    );
    expect(summary.headline).toBe("Rejected in constitutional review");
    expect(summary.detail).toContain("not a community vote");
  });

  it("frames a failure as a governance outcome that cannot be disputed", () => {
    const summary = summarizeProposal(
      makeProposal({ status: "failed", failureReason: "quorum_not_met" }),
      config,
      NOW,
    );
    expect(summary.headline).toBe("Failed");
    expect(summary.detail).toContain("Quorum was not met");
    expect(summary.nextStep).toContain("cannot be disputed");
    expect(summary.actionRequired).toBe("none");
  });

  it("does not invent a failure cause it does not recognise", () => {
    const summary = summarizeProposal(
      makeProposal({ status: "failed", failureReason: "something_new" }),
      config,
      NOW,
    );
    expect(summary.detail).toContain(
      "did not meet the configured governance requirements",
    );
  });

  it("says when no action is required, and when one is possible", () => {
    expect(
      summarizeProposal(makeProposal({ status: "passed" }), config, NOW).actionRequired,
    ).toBe("none");
    expect(
      summarizeProposal(makeProposal({ status: "pending" }), config, NOW).actionRequired,
    ).toBe("possible");
  });

  it("explains the stewardship step for a confirmed constitution change", () => {
    const summary = summarizeProposal(
      makeProposal({ status: "pending_constitution_confirm" }),
      config,
      NOW,
    );
    expect(summary.headline).toBe("Awaiting stewardship confirmation");
    expect(summary.nextStep).toContain("GovLayerCore then applies it");
  });
});

describe("stewardship action state", () => {
  it("separates awaiting approvals, awaiting the timelock, and ready", () => {
    expect(
      deriveAdminActionStage(makePendingAction({ status: "pending_approvals" }), NOW),
    ).toBe("awaiting_approvals");
    expect(
      deriveAdminActionStage(
        makePendingAction({ status: "timelocked", readyAt: NOW + 60 }),
        NOW,
      ),
    ).toBe("awaiting_timelock");
    expect(
      deriveAdminActionStage(
        makePendingAction({ status: "timelocked", readyAt: NOW - 1 }),
        NOW,
      ),
    ).toBe("ready_to_execute");
  });

  it("reports the timelock countdown only while timelocked", () => {
    expect(
      timelockRemaining(
        makePendingAction({ status: "timelocked", readyAt: NOW + 600 }),
        NOW,
      ),
    ).toBe(600);
    expect(
      timelockRemaining(makePendingAction({ status: "pending_approvals" }), NOW),
    ).toBeNull();
  });

  it("tracks approval progress against the threshold", () => {
    expect(approvalProgress(makePendingAction({ validApprovalsNow: 1 }), 2)).toEqual({
      recorded: 1,
      required: 2,
      met: false,
    });
  });

  it("never reports executed as applied", () => {
    expect(
      deriveApplicationState({
        action: makePendingAction({ status: "executed" }),
        appliedToCore: false,
        pullRejected: false,
      }),
    ).toBe("awaiting_application");
  });

  it("reports applied only when Core records it", () => {
    expect(
      deriveApplicationState({
        action: makePendingAction({ status: "executed" }),
        appliedToCore: true,
        pullRejected: false,
      }),
    ).toBe("applied");
  });

  it("gives a rejected pull precedence, because that outcome is permanent", () => {
    expect(
      deriveApplicationState({
        action: makePendingAction({ status: "executed" }),
        appliedToCore: false,
        pullRejected: true,
      }),
    ).toBe("pull_rejected");
  });

  it("reports actions that have not been executed yet", () => {
    expect(
      deriveApplicationState({
        action: makePendingAction({ status: "timelocked" }),
        appliedToCore: false,
        pullRejected: false,
      }),
    ).toBe("awaiting_execution");
  });
});

