import { beforeEach, describe, expect, it } from "vitest";
import type { AdminAction } from "@/domain/types";
import { makeAdminAction } from "@/domain/testFactories";
import { AppError } from "@/lib/errors";
import {
  cachedHighWaterMark,
  formatActionId,
  parseActionId,
  resetActionHistoryCache,
  scanAdminActionHistory,
} from "./actionHistory";
import type { GovLayerAdminAdapter } from "./GovLayerAdminAdapter";

const ADMIN_ADDRESS = "0xf85b2e784c984Dc456C2827e321cC7C26320df84";

/**
 * The two rejection shapes seen from the live network.
 *
 * Verified against the deployed contracts: a lookup for an id the contract never
 * allocated is rejected by the network as an unreadable execution failure, not as
 * a readable "not found" message. Both shapes are exercised here.
 */
function contractNotFound(): AppError {
  return new AppError({
    kind: "not_found",
    message: "The requested record does not exist on chain.",
    raw: "Action not found",
  });
}

function rpcExecutionFailed(): AppError {
  return new AppError({
    kind: "verification_uncertainty",
    message: "The read could not be verified right now.",
    raw: "Missing or invalid parameters. Details: execution failed",
  });
}

function fakeAdapter(
  actions: readonly AdminAction[],
  rejection: "contract" | "rpc" = "contract",
  failure?: (counter: number) => Error | undefined,
) {
  const byCounter = new Map<number, AdminAction>();
  for (const action of actions) {
    const counter = parseActionId(action.actionId);
    if (counter !== null) byCounter.set(counter, action);
  }

  return {
    address: ADMIN_ADDRESS,
    getAction: async (actionId: string): Promise<AdminAction> => {
      const counter = parseActionId(actionId);
      if (counter === null) throw contractNotFound();

      const injected = failure?.(counter);
      if (injected !== undefined) throw injected;

      const found = byCounter.get(counter);
      if (found === undefined) {
        throw rejection === "rpc" ? rpcExecutionFailed() : contractNotFound();
      }
      return found;
    },
  } as unknown as GovLayerAdminAdapter;
}

describe("action id format", () => {
  it("starts at zero, as the contract's counter does", () => {
    expect(formatActionId(0)).toBe("ACTION-00000000");
    expect(formatActionId(1)).toBe("ACTION-00000001");
    expect(parseActionId("ACTION-00000000")).toBe(0);
    expect(parseActionId("ACTION-00000042")).toBe(42);
  });

  it("rejects ids that are not in the contract's format", () => {
    expect(parseActionId("ACTION-abc")).toBeNull();
    expect(parseActionId("42")).toBeNull();
    expect(() => formatActionId(-1)).toThrowError(RangeError);
  });
});

describe("scanAdminActionHistory", () => {
  beforeEach(() => {
    resetActionHistoryCache();
  });

  // The live chain currently holds ACTION-00000000 as its first action.
  const actions = [
    makeAdminAction({ actionId: formatActionId(0), status: "timelocked" }),
    makeAdminAction({ actionId: formatActionId(1), status: "executed" }),
    makeAdminAction({ actionId: formatActionId(2), status: "expired" }),
  ];

  it("finds the first action, which is ACTION-00000000", async () => {
    const result = await scanAdminActionHistory(
      fakeAdapter([actions[0] as AdminAction]),
      { useCache: false },
    );

    expect(result.actions.map((action) => action.actionId)).toEqual([
      "ACTION-00000000",
    ]);
    expect(result.highWaterMark).toBe(0);
    expect(result.complete).toBe(true);
  });

  it("returns executed and expired actions, not just active ones", async () => {
    const result = await scanAdminActionHistory(fakeAdapter(actions), {
      useCache: false,
    });

    expect(result.actions.map((action) => action.actionId)).toEqual([
      "ACTION-00000000",
      "ACTION-00000001",
      "ACTION-00000002",
    ]);
    expect(result.highWaterMark).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.reads).toBe(4);
  });

  it("handles a contract with no actions at all", async () => {
    const result = await scanAdminActionHistory(fakeAdapter([]), {
      useCache: false,
    });

    expect(result.actions).toEqual([]);
    expect(result.highWaterMark).toBe(-1);
    expect(result.complete).toBe(true);
    expect(cachedHighWaterMark(ADMIN_ADDRESS)).toBe(-1);
  });

  it("stops and reports when an unallocated id is rejected unreadably", async () => {
    // This mirrors the live network: the id past the allocated range is rejected
    // with an unreadable execution failure rather than a readable "not found".
    const result = await scanAdminActionHistory(fakeAdapter(actions, "rpc"), {
      useCache: false,
    });

    expect(result.actions).toHaveLength(3);
    expect(result.highWaterMark).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.stoppedAt).toBe(3);
    expect(result.stopReason).toContain("execution failed");
  });

  it("keeps the walk complete when the contract answers not-found itself", async () => {
    const result = await scanAdminActionHistory(
      fakeAdapter(actions, "contract"),
      { useCache: false },
    );

    expect(result.complete).toBe(true);
    expect(result.stoppedAt).toBeNull();
  });

  it("reports incompleteness when it stops at the scan cap", async () => {
    const result = await scanAdminActionHistory(fakeAdapter(actions), {
      useCache: false,
      maxScan: 2,
    });

    expect(result.actions).toHaveLength(2);
    expect(result.highWaterMark).toBe(1);
    expect(result.complete).toBe(false);
  });

  it("keeps the actions it found when a mid-range read fails", async () => {
    const adapter = fakeAdapter(actions, "contract", (counter) =>
      counter === 1 ? rpcExecutionFailed() : undefined,
    );

    const result = await scanAdminActionHistory(adapter, { useCache: false });

    expect(result.actions.map((action) => action.actionId)).toEqual([
      "ACTION-00000000",
    ]);
    expect(result.stoppedAt).toBe(1);
    expect(result.complete).toBe(false);
  });

  it("memoises the highest known id so later scans stay cheap", async () => {
    const adapter = fakeAdapter(actions);

    const first = await scanAdminActionHistory(adapter, { useCache: false });
    expect(first.reads).toBe(4);
    expect(cachedHighWaterMark(ADMIN_ADDRESS)).toBe(2);

    const second = await scanAdminActionHistory(adapter);
    expect(second.reads).toBe(1);
    expect(second.actions).toEqual([]);
    expect(second.highWaterMark).toBe(2);
  });

  it("finds an action created after a previous scan", async () => {
    const first = fakeAdapter(actions);
    await scanAdminActionHistory(first, { useCache: false });

    const next = makeAdminAction({ actionId: formatActionId(3) });
    const second = await scanAdminActionHistory(fakeAdapter([...actions, next]));

    expect(second.actions.map((action) => action.actionId)).toEqual([
      "ACTION-00000003",
    ]);
    expect(second.highWaterMark).toBe(3);
  });
});

