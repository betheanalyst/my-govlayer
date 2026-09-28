import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { buildWriteReport, notAttempted } from "./writeReport";
import type { WriteOutcome } from "@/adapters/client";

/**
 * The reporting rule this guards: only a transaction that finalized *and*
 * executed may be described as recorded, and a wallet problem is never dressed
 * up as a protocol result.
 */

const HASH = "0x" + "a".repeat(64);

describe("buildWriteReport", () => {
  it("calls a confirmed execution recorded, and still defers to the re-read", () => {
    const report = buildWriteReport({
      action: "Vote yes on proposal #3",
      outcome: { kind: "confirmed", hash: HASH, receipt: {} } as WriteOutcome,
      observed: "Tally is now 2 yes, 1 no.",
    });
    expect(report.recorded).toBe(true);
    expect(report.submitted).toBe(true);
    expect(report.headline).toBe("Recorded on chain");
    expect(report.detail).toContain("read back");
    expect(report.observed).toBe("Tally is now 2 yes, 1 no.");
  });

  it("separates a finalized transaction whose execution failed", () => {
    const report = buildWriteReport({
      action: "Vote yes on proposal #3",
      outcome: {
        kind: "execution_failed",
        hash: HASH,
        receipt: {},
        error: new AppError({
          kind: "protocol_state",
          message: "A vote from this address is already recorded on this proposal.",
        }),
      } as WriteOutcome,
    });
    expect(report.recorded).toBe(false);
    expect(report.submitted).toBe(true);
    expect(report.headline).toBe("The contract refused this action");
    expect(report.error?.message).toContain("already recorded");
  });

  it("does not claim state change when finality was not confirmed", () => {
    const report = buildWriteReport({
      action: "Finalize proposal #2",
      outcome: {
        kind: "not_finalized",
        hash: HASH,
        statusName: "PENDING",
        error: new AppError({ kind: "transaction_failure", message: "unknown" }),
      } as WriteOutcome,
    });
    expect(report.submitted).toBe(true);
    expect(report.recorded).toBe(false);
    expect(report.detail).toContain("not known from here");
    expect(report.observed).toBeNull();
  });

  it("reports a wallet refusal as not attempted, never as a network result", () => {
    const report = buildWriteReport({
      action: "Submit a proposal",
      outcome: notAttempted(
        new AppError({
          kind: "wallet",
          message: "No compatible wallet provider is available in this browser.",
        }),
      ),
    });
    expect(report.submitted).toBe(false);
    expect(report.recorded).toBe(false);
    expect(report.hash).toBeNull();
    expect(report.headline).toBe("Not attempted");
  });
});
