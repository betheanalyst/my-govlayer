import { describe, expect, it } from "vitest";
import {
  AppError,
  classifyContractMessage,
  classifyError,
  extractMessage,
  toAppError,
  verificationUncertainty,
} from "./errors";

describe("classifyContractMessage", () => {
  it("classifies eligibility reverts as user restrictions", () => {
    const result = classifyContractMessage(
      "Insufficient tokens to vote. Required: 100",
    );
    expect(result.kind).toBe("user_restriction");
    expect(result.raw).toContain("Insufficient tokens to vote");
  });

  it("classifies a second vote as a protocol state restriction", () => {
    const result = classifyContractMessage(
      "Already voted on this proposal. Votes are immutable once cast and cannot be changed, overwritten, withdrawn, or recast.",
    );
    expect(result.kind).toBe("protocol_state");
    expect(result.message).toContain("immutable");
  });

  it("classifies an elapsed voting window without calling it a failure", () => {
    const result = classifyContractMessage(
      "Voting period has closed (closed at Unix 1700000000)",
    );
    expect(result.kind).toBe("protocol_state");
    expect(result.message).toBe("The voting period for this proposal has closed.");
  });

  it("describes the pause as submission-only, matching the contract", () => {
    const result = classifyContractMessage(
      "Proposal submission is currently paused by Admin-authorized action. This is an abuse-containment pause, not an emergency affecting other governance activity -- voting, disputing, finalizing, resubmitting, and cancelling remain unaffected.",
    );
    expect(result.kind).toBe("protocol_state");
    expect(result.message).toContain("Voting, disputing, finalizing");
    expect(result.recoverable).toBe(true);
  });

  it("classifies an unreachable Admin as a cross-contract failure", () => {
    const result = classifyContractMessage(
      "Unable to reach GovLayerAdmin to pull this action. Try again once the Admin contract is reachable.",
    );
    expect(result.kind).toBe("cross_contract");
    expect(result.recoverable).toBe(true);
  });

  it("classifies a permanent pull rejection as terminal protocol state", () => {
    const result = classifyContractMessage(
      "Action's pull was already rejected due to stale Core-side state at a prior attempt",
    );
    expect(result.kind).toBe("protocol_state");
    expect(result.message).toContain("permanent");
    expect(result.recoverable).toBe(false);
  });

  it("classifies non-admin callers as a user restriction", () => {
    const result = classifyContractMessage(
      "Not admin: only a current admin may propose adding an admin",
    );
    expect(result.kind).toBe("user_restriction");
  });

  it("keeps unmatched messages honest rather than inventing a mapping", () => {
    const result = classifyContractMessage("Some future revert wording");
    expect(result.kind).toBe("unknown");
    expect(result.raw).toBe("Some future revert wording");
  });

  it("never reports an RPC request limit as a protocol answer", () => {
    // The public GenLayer endpoint answers "Rate limit exceeded: 30 requests
    // per minute". That is infrastructure, not GovLayerCore speaking, so it
    // must not become a protocol-state rejection.
    const result = classifyContractMessage(
      "Rate limit exceeded: 30 requests per minute",
    );
    expect(result.kind).toBe("verification_uncertainty");
    expect(result.recoverable).toBe(true);
    expect(result.raw).toBe("Rate limit exceeded: 30 requests per minute");
  });

  it("still classifies GovLayerCore's own submission limit as protocol state", () => {
    const result = classifyContractMessage(
      "Rate limit exceeded: at most 7 proposals per 604800 seconds (next allowed after Unix 1700000000)",
    );
    expect(result.kind).toBe("protocol_state");
    expect(result.message).toBe(
      "The proposal rate limit for this address has been reached.",
    );
  });
});

describe("classifyError / toAppError", () => {
  it("passes an existing AppError through unchanged", () => {
    const original = new AppError({ kind: "validation", message: "nope" });
    expect(classifyError(original)).toBe(original);
    expect(toAppError(original)).toBe(original);
  });

  it("classifies an Error by its message", () => {
    const result = classifyError(new Error("Proposal does not exist"));
    expect(result.kind).toBe("not_found");
  });

  it("extracts messages from strings, Errors, and error-like objects", () => {
    expect(extractMessage("plain")).toBe("plain");
    expect(extractMessage(new Error("boom"))).toBe("boom");
    expect(extractMessage({ shortMessage: "short" })).toBe("short");
    expect(extractMessage({ message: "long" })).toBe("long");
  });
});

describe("verificationUncertainty", () => {
  it("is distinct from a negative answer", () => {
    const error = verificationUncertainty("Voting eligibility", new Error("rpc down"));
    expect(error.kind).toBe("verification_uncertainty");
    expect(error.message).toContain("could not be verified");
    expect(error.message).not.toContain("not eligible");
    expect(error.recoverable).toBe(true);
    expect(error.raw).toBe("rpc down");
  });
});
