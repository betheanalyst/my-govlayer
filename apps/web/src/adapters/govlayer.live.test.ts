import { beforeAll, describe, expect, it } from "vitest";
import { parseRuntimeConfig, readEnvSource } from "@/config/env";
import { primaryRpcUrl, readChainId, resolveNetwork } from "@/config/network";
import { isHexAddress } from "@/lib/hex";
import { deriveAdminActionStage } from "@/domain/state";
import { descendingWindow } from "@/lib/pagination";
import { GovLayerAdminAdapter } from "./GovLayerAdminAdapter";
import { getDefaultConnection, readContractView } from "./client";
import { GovLayerCoreAdapter } from "./GovLayerCoreAdapter";

/**
 * Live smoke test (Frontend Foundation Standard section 10).
 *
 * Runs against the real Studionet deployment and the real GovLayerCore /
 * GovLayerAdmin addresses from `.env.local`. Verifies connectivity, client
 * creation, representative reads, representative protocol values, address
 * handling, and BigInt/value handling.
 *
 * Read-only by design: it never submits a transaction, so it can be run
 * repeatedly without side effects.
 */
const config = parseRuntimeConfig(readEnvSource());
const preset = resolveNetwork(config.network);
const core = new GovLayerCoreAdapter();
const admin = new GovLayerAdminAdapter();

describe("live GovLayer smoke test", () => {
  /**
   * Warm the connection before the burst of reads below.
   *
   * This suite issues roughly thirty reads in quick succession, and the public
   * Studio endpoint intermittently drops a single request under that load
   * (`fetch failed`). That is the endpoint's behaviour, not a defect this project
   * can fix, and it is surfaced honestly: a dropped read is reported as
   * verification uncertainty, never as a wrong protocol value.
   *
   * This warm-up prunes the cold-connection case so the burst starts on an
   * established connection. It is deliberately not a retry for every assertion:
   * masking intermittent drops would hide a real regression if the endpoint's
   * behaviour ever changed for the worse.
   */
  beforeAll(async () => {
    try {
      await fetch(primaryRpcUrl(preset), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
    } catch {
      // Ignored on purpose: the assertions that follow own the verdict.
    }
  }, 20_000);

  it("has a configured deployment to test against", () => {
    expect(isHexAddress(config.coreAddress)).toBe(true);
    expect(isHexAddress(config.adminAddress)).toBe(true);
    expect(config.coreAddress).not.toBe(config.adminAddress);
    expect(primaryRpcUrl(preset)).toMatch(/^https?:\/\//);
  });

  it("reaches the configured RPC and reports the expected chain id", async () => {
    const chainId = await readChainId(preset);
    expect(chainId).toBe(preset.chain.id);
  });

  it("creates a GenLayer client and performs a raw contract read", async () => {
    const connection = getDefaultConnection();
    expect(connection.client).toBeDefined();

    const raw = await readContractView({
      address: config.coreAddress,
      functionName: "is_admin_contract_configured",
    });

    expect(typeof raw).toBe("boolean");
  });

  it("reads the full governance configuration with exact integer values", async () => {
    const governance = await core.getConfig();

    expect(typeof governance.proposalCount).toBe("bigint");
    expect(governance.proposalCount >= 0n).toBe(true);
    expect(typeof governance.governanceHistoryCount).toBe("bigint");
    expect(governance.minQuorum).toBeGreaterThan(0n);
    expect(governance.approvalThresholdPercent).toBeGreaterThan(0n);
    expect(governance.minVotingDuration).toBeGreaterThan(0);
    expect(governance.maxVotingDuration).toBeGreaterThanOrEqual(
      governance.minVotingDuration,
    );
    expect(["open", "erc20", "nft", "custom", "unrecognized"]).toContain(
      governance.eligibilityMode,
    );
    expect(["equal", "token_weighted", "unrecognized"]).toContain(
      governance.votingWeightMode,
    );
    expect(governance.adminContractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(governance.votingToken).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("reads Core's own view of whether Admin is wired in", async () => {
    const wired = await core.isAdminContractConfigured();
    expect(typeof wired).toBe("boolean");
  });

  it("reads the stewardship snapshot from GovLayerAdmin", async () => {
    const snapshot = await admin.getSnapshot();

    expect(snapshot.activeAdminCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.admins).toHaveLength(snapshot.activeAdminCount);
    expect(snapshot.currentThreshold).toBeGreaterThanOrEqual(0);
    expect(typeof snapshot.paused).toBe("boolean");
    expect(typeof snapshot.bootstrapComplete).toBe("boolean");
  });

  it("reads admin rate-limit parameters with BigInt precision", async () => {
    const rateLimit = await admin.getRateLimitParams();

    expect(typeof rateLimit.maxProposalsPerWindow).toBe("bigint");
    expect(rateLimit.maxProposalsPerWindow).toBeGreaterThan(0n);
    expect(rateLimit.proposalRateWindowSecs).toBeGreaterThan(0);
  });

  it("reads a bounded newest-first page of proposals", async () => {
    const governance = await core.getConfig();
    const total = Number(governance.proposalCount);
    const pageSize = 3;
    const window = descendingWindow(total, 0, pageSize);

    // Both contracts reject limit <= 0, so an empty window is never sent.
    if (window.isEmpty) {
      expect(total).toBe(0);
      expect(window.limit).toBe(0);
      return;
    }

    const proposals = await core.listProposals(window.offset, window.limit);

    expect(proposals.length).toBeLessThanOrEqual(pageSize);
    expect(proposals.length).toBe(window.limit);
    for (const proposal of proposals) {
      expect(typeof proposal.votesYes).toBe("bigint");
      expect(typeof proposal.votesNo).toBe("bigint");
      expect(proposal.votingClosesAt).toBeGreaterThan(0);
      expect(proposal.title.length).toBeGreaterThan(0);
      expect(proposal.rawStatus.length).toBeGreaterThan(0);
    }
  });

  it("reads the constitution version history", async () => {
    const governance = await core.getConfig();
    const window = descendingWindow(Number(governance.constitutionVersion), 0, 1);

    const versions = await core.getConstitutionHistory(window.offset, window.limit);

    expect(versions).toHaveLength(1);
    const latest = versions[0];
    expect(latest?.version).toBe(governance.constitutionVersion);
    expect(latest?.text.length).toBeGreaterThan(0);
  });

  it("lists currently active stewardship actions without failing on an empty set", async () => {
    const pending = await admin.getPendingActions(0, 10);
    expect(Array.isArray(pending)).toBe(true);
    for (const action of pending) {
      expect(action.actionId).toMatch(/^ACTION-\d+$/);
      expect(["pending_approvals", "timelocked"]).toContain(action.status);
    }
  });

  it("reads a full authorized action and derives its stage from the recorded status", async () => {
    // Action ids are allocated from zero, so ACTION-00000000 exists whenever the
    // deployment has ever authorized anything. It is read through `get_action`,
    // which is also the only way to reach executed and expired records.
    const action = await admin.getAction("ACTION-00000000");

    expect(action.actionId).toBe("ACTION-00000000");
    expect(action.actionType.length).toBeGreaterThan(0);
    expect(["pending_approvals", "timelocked", "executed", "expired"]).toContain(
      action.rawStatus,
    );
    expect(action.validApprovalsNow).toBeGreaterThanOrEqual(0);
    expect(action.currentThreshold).toBeGreaterThan(0);

    const stage = deriveAdminActionStage(action, Math.floor(Date.now() / 1000));
    expect(stage).not.toBe("unrecognized");
  });

  it("reads Core's own answer on whether an authorization was applied", async () => {
    // The trust boundary in one read: `executed` on GovLayerAdmin is
    // authorization, and this is the contract that says whether it took effect.
    const applied = await core.isAdminActionApplied("ACTION-00000000");
    expect(typeof applied).toBe("boolean");
  });
});
