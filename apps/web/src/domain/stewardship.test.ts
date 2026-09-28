import { describe, expect, it } from "vitest";
import {
  ADMIN_APPLIED_ACTION_TYPES,
  CORE_APPLIED_ACTION_TYPES,
  actionApplier,
  approvalWindowState,
  bucketStewardshipActions,
  compareActionIdsDescending,
  describeActionEffect,
  stewardshipPriority,
} from "./stewardship";
import { makePendingAction } from "./testFactories";

/**
 * The classifications here were read out of the contracts: five action types are
 * applied by GovLayerAdmin itself at execution, and seven only reach `executed`
 * as an authorization for GovLayerCore to pull and apply.
 */

const NOW = 1_700_000_000;

describe("actionApplier", () => {
  it("knows which types the stewardship contract applies itself", () => {
    for (const type of ADMIN_APPLIED_ACTION_TYPES) {
      expect(actionApplier(type)).toBe("admin");
    }
  });

  it("knows which types only Core applies", () => {
    for (const type of CORE_APPLIED_ACTION_TYPES) {
      expect(actionApplier(type)).toBe("core");
    }
  });

  it("claims nothing about an unrecognised type", () => {
    expect(actionApplier("set_something_new")).toBe("unrecognized");
  });

  it("describes every recognised type, and says so when it cannot", () => {
    for (const type of [...ADMIN_APPLIED_ACTION_TYPES, ...CORE_APPLIED_ACTION_TYPES]) {
      expect(describeActionEffect(type)).not.toContain("does not recognise");
    }
    expect(describeActionEffect("unknown_type")).toContain("does not recognise");
  });
});

describe("stewardshipPriority", () => {
  it("maps recorded statuses to the overview priorities", () => {
    expect(
      stewardshipPriority(
        makePendingAction({ status: "pending_approvals" }),
        NOW,
      ),
    ).toBe("requires_approval");
    expect(
      stewardshipPriority(makePendingAction({ status: "executed" }), NOW),
    ).toBe("recently_applied");
    expect(stewardshipPriority(makePendingAction({ status: "expired" }), NOW)).toBe(
      "recently_expired",
    );
  });

  it("splits timelocked actions by the timelock clock", () => {
    const notReady = makePendingAction({ status: "timelocked", readyAt: NOW + 60 });
    const ready = makePendingAction({ status: "timelocked", readyAt: NOW - 1 });

    expect(stewardshipPriority(notReady, NOW)).toBe("timelocked");
    expect(stewardshipPriority(ready, NOW)).toBe("ready_to_execute");
  });
});

describe("approvalWindowState", () => {
  it("reports an elapsed window as recorded state, not an error", () => {
    const open = approvalWindowState(
      makePendingAction({ status: "pending_approvals", expiresAt: NOW + 60 }),
      NOW,
    );
    const elapsed = approvalWindowState(
      makePendingAction({ status: "pending_approvals", expiresAt: NOW - 60 }),
      NOW,
    );

    expect(open.state).toBe("open");
    expect(elapsed.state).toBe("elapsed");
  });

  it("does not apply to actions past the approval stage", () => {
    expect(
      approvalWindowState(makePendingAction({ status: "executed" }), NOW).state,
    ).toBe("not_applicable");
  });
});

describe("bucketStewardshipActions", () => {
  it("groups by priority and orders each group newest proposal first", () => {
    const buckets = bucketStewardshipActions(
      [
        makePendingAction({ actionId: "ACTION-00000001", status: "pending_approvals" }),
        makePendingAction({ actionId: "ACTION-00000003", status: "pending_approvals" }),
        makePendingAction({ actionId: "ACTION-00000002", status: "expired" }),
      ],
      { now: NOW },
    );

    expect(buckets.requires_approval.map((action) => action.actionId)).toEqual([
      "ACTION-00000003",
      "ACTION-00000001",
    ]);
    expect(buckets.recently_expired).toHaveLength(1);
    expect(buckets.ready_to_execute).toHaveLength(0);
  });
});

describe("compareActionIdsDescending", () => {
  it("orders numerically, not lexically, and keeps odd ids out of the way", () => {
    expect(compareActionIdsDescending("ACTION-00000010", "ACTION-00000009")).toBeLessThan(0);
    expect(compareActionIdsDescending("not-an-id", "ACTION-00000009")).toBeGreaterThan(0);
  });
});
