import { describe, expect, it } from "vitest";
import {
  isUserRejection,
  parseChainId,
  walletFailure,
  walletRejected,
  walletUnavailable,
} from "./eip1193";

/**
 * Wallet error mapping. The distinction that matters: a request the user
 * declined, a missing provider, and an unknown provider failure are three
 * different things, and none of them is a protocol answer.
 */

describe("parseChainId", () => {
  it("reads hex and decimal chain ids", () => {
    expect(parseChainId("0xf22f")).toBe(61999);
    expect(parseChainId("0x1")).toBe(1);
    expect(parseChainId(61999)).toBe(61999);
  });

  it("returns null for anything it cannot read rather than guessing", () => {
    expect(parseChainId("not-a-chain")).toBeNull();
    expect(parseChainId(null)).toBeNull();
    expect(parseChainId(0)).toBeNull();
    expect(parseChainId(-1)).toBeNull();
  });
});

describe("wallet error mapping", () => {
  it("recognises a declined request by its EIP-1193 code", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ code: -32002 })).toBe(true);
    expect(isUserRejection({ code: -32603 })).toBe(false);
    expect(isUserRejection("nope")).toBe(false);
  });

  it("reports a missing provider as a wallet problem, not a protocol one", () => {
    const error = walletUnavailable();
    expect(error.kind).toBe("wallet");
    expect(error.nextStep).toContain("Browsing and verification work without a wallet");
  });

  it("states that a declined request submitted nothing", () => {
    expect(walletRejected().nextStep).toContain("Nothing was submitted");
  });

  it("preserves the recorded provider message", () => {
    const error = walletFailure(new Error("provider exploded"));
    expect(error.kind).toBe("wallet");
    expect(error.raw).toBe("provider exploded");
  });
});
