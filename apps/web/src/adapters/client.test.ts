import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import type { GenLayerTransaction } from "genlayer-js/types";
import { describe, expect, it } from "vitest";
import { asTransactionHash } from "@/lib/hex";
import { classifyReceipt } from "./client";

const HASH = asTransactionHash(`0x${"a".repeat(64)}`);

/** Minimal receipt stub: only the fields the classifier is allowed to read. */
function receipt(partial: Record<string, unknown>): GenLayerTransaction {
  return partial as unknown as GenLayerTransaction;
}

describe("classifyReceipt", () => {
  it("treats only a finalized, successfully executed transaction as confirmed", () => {
    const outcome = classifyReceipt(
      HASH,
      receipt({
        statusName: TransactionStatus.FINALIZED,
        txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
      }),
    );

    expect(outcome.kind).toBe("confirmed");
  });

  it("reports finalized-but-failed execution as a classified error", () => {
    const outcome = classifyReceipt(
      HASH,
      receipt({
        statusName: TransactionStatus.FINALIZED,
        txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR,
        data: { error: "Already voted on this proposal." },
      }),
    );

    expect(outcome.kind).toBe("execution_failed");
    if (outcome.kind === "execution_failed") {
      expect(outcome.error.kind).toBe("protocol_state");
      expect(outcome.error.raw).toBe("Already voted on this proposal.");
    }
  });

  it("does not invent a reason when the receipt carries none", () => {
    const outcome = classifyReceipt(
      HASH,
      receipt({
        statusName: TransactionStatus.FINALIZED,
        txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR,
      }),
    );

    expect(outcome.kind).toBe("execution_failed");
    if (outcome.kind === "execution_failed") {
      expect(outcome.error.message).toContain("no readable reason");
      expect(outcome.error.raw).toBeUndefined();
    }
  });

  it("treats a finalized transaction with no reported execution as unverified", () => {
    const outcome = classifyReceipt(
      HASH,
      receipt({ statusName: TransactionStatus.FINALIZED, txExecutionResultName: undefined }),
    );

    expect(outcome.kind).toBe("not_finalized");
    if (outcome.kind === "not_finalized") {
      expect(outcome.error.kind).toBe("verification_uncertainty");
    }
  });

  it("never claims success for a non-finalized status", () => {
    const outcome = classifyReceipt(
      HASH,
      receipt({
        statusName: TransactionStatus.ACCEPTED,
        txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
      }),
    );

    expect(outcome.kind).toBe("not_finalized");
  });

  it("reports cancelled and timeout statuses as failures", () => {
    for (const statusName of [
      TransactionStatus.CANCELED,
      TransactionStatus.UNDETERMINED,
      TransactionStatus.VALIDATORS_TIMEOUT,
      TransactionStatus.LEADER_TIMEOUT,
    ]) {
      const outcome = classifyReceipt(HASH, receipt({ statusName }));
      expect(outcome.kind).toBe("not_finalized");
      if (outcome.kind === "not_finalized") {
        expect(outcome.error.kind).toBe("transaction_failure");
      }
    }
  });
});
