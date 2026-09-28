import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeConfig, makeEvent, makeProposal } from "@/domain/testFactories";
import { AppError } from "@/lib/errors";
import {
  adminActionAppliedQuery,
  constitutionVersionQuery,
  governanceHistoryPageQuery,
  proposalPageQuery,
} from "./coreQueries";
import {
  invalidateAfterAdminWrite,
  invalidateAfterCoreWrite,
} from "./invalidation";
import { queryKeys } from "./keys";
import { shouldRetryRead } from "./policy";

/** Invokes a query option's fetcher the way React Query would. */
function runQuery<T>(options: { queryFn?: unknown }): Promise<T> {
  const queryFn = options.queryFn as (context: unknown) => Promise<T>;
  return queryFn({ queryKey: [], signal: new AbortController().signal });
}

interface FakeCoreOptions {
  readonly proposalCount?: bigint;
  readonly constitutionVersion?: bigint;
  readonly historyCount?: bigint;
}

function fakeCore(options: FakeCoreOptions = {}) {
  const calls: string[] = [];

  const adapter = {
    getConfig: async () => {
      calls.push("getConfig");
      return makeConfig({
        proposalCount: options.proposalCount ?? 0n,
        constitutionVersion: options.constitutionVersion ?? 1n,
        governanceHistoryCount: options.historyCount ?? 0n,
      });
    },
    listProposals: async (offset: number, limit: number) => {
      calls.push(`listProposals:${offset}:${limit}`);
      return [makeProposal({ proposalId: BigInt(offset + 1) })];
    },
    getGovernanceHistory: async (offset: number, limit: number) => {
      calls.push(`getGovernanceHistory:${offset}:${limit}`);
      return [makeEvent()];
    },
    getConstitutionHistory: async (offset: number, limit: number) => {
      calls.push(`getConstitutionHistory:${offset}:${limit}`);
      return [
        {
          version: BigInt(offset + 1),
          text: "Constitution text",
          adoptedAt: 1_700_000_000,
          adoptedViaProposalId: 0n,
          adoptedBy: "genesis",
        },
      ];
    },
    isAdminActionApplied: async (actionId: string) => {
      calls.push(`isAdminActionApplied:${actionId}`);
      return true;
    },
  };

  return { adapter: adapter as never, calls };
}

describe("proposalPageQuery", () => {
  it("reads the newest page as a descending window", async () => {
    const { adapter, calls } = fakeCore({ proposalCount: 5n });
    const page = await runQuery<{ proposals: readonly unknown[]; hasOlder: boolean }>(
      proposalPageQuery(0, 3, adapter),
    );

    expect(calls).toContain("listProposals:2:3");
    expect(page.hasOlder).toBe(true);
  });

  it("never sends an empty window to the contract", async () => {
    const { adapter, calls } = fakeCore({ proposalCount: 0n });
    const page = await runQuery<{ proposals: readonly unknown[]; total: number }>(
      proposalPageQuery(0, 3, adapter),
    );

    // The contracts revert on limit = 0, so the read is skipped entirely.
    expect(calls).not.toContain("listProposals:0:0");
    expect(page.proposals).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("skips the read when paging past the start of the collection", async () => {
    const { adapter, calls } = fakeCore({ proposalCount: 3n });
    await runQuery(proposalPageQuery(5, 3, adapter));

    expect(calls.some((call) => call.startsWith("listProposals"))).toBe(false);
  });
});

describe("governanceHistoryPageQuery", () => {
  it("returns the newest events first and skips empty windows", async () => {
    const withEvents = fakeCore({ historyCount: 4n });
    await runQuery(governanceHistoryPageQuery(0, 2, withEvents.adapter));
    expect(withEvents.calls).toContain("getGovernanceHistory:2:2");

    const empty = fakeCore({ historyCount: 0n });
    const page = await runQuery<{ events: readonly unknown[] }>(
      governanceHistoryPageQuery(0, 2, empty.adapter),
    );
    expect(page.events).toEqual([]);
    expect(empty.calls).not.toContain("getGovernanceHistory:0:0");
  });
});

describe("constitutionVersionQuery", () => {
  it("maps a version number onto the contract's 0-based offset", async () => {
    const { adapter, calls } = fakeCore({ constitutionVersion: 2n });
    const version = await runQuery<{ version: bigint }>(
      constitutionVersionQuery(2n, adapter),
    );

    expect(calls).toContain("getConstitutionHistory:1:1");
    expect(version.version).toBe(2n);
  });

  it("rejects a version below the contract's numbering", async () => {
    const { adapter } = fakeCore();
    await expect(runQuery(constitutionVersionQuery(0n, adapter))).rejects.toThrowError(
      RangeError,
    );
  });
});

describe("adminActionAppliedQuery", () => {
  it("asks Core whether an authorization was actually applied", async () => {
    const { adapter, calls } = fakeCore();
    const applied = await runQuery<boolean>(
      adminActionAppliedQuery("ACTION-00000009", adapter),
    );

    expect(calls).toContain("isAdminActionApplied:ACTION-00000009");
    expect(applied).toBe(true);
  });
});

describe("policy", () => {
  it("retries only failures that could succeed on a second attempt", () => {
    expect(
      shouldRetryRead(0, new AppError({ kind: "verification_uncertainty", message: "" })),
    ).toBe(true);
    expect(
      shouldRetryRead(0, new AppError({ kind: "cross_contract", message: "" })),
    ).toBe(true);
  });

  it("never retries a definitive protocol answer", () => {
    for (const kind of ["protocol_state", "not_found", "user_restriction", "validation", "configuration"] as const) {
      expect(shouldRetryRead(0, new AppError({ kind, message: "" }))).toBe(false);
    }
  });

  it("stops after the bounded number of attempts", () => {
    const error = new AppError({ kind: "verification_uncertainty", message: "" });
    expect(shouldRetryRead(1, error)).toBe(true);
    expect(shouldRetryRead(2, error)).toBe(false);
  });
});

describe("query keys", () => {
  it("keeps distinctive parameters in the key", () => {
    expect(queryKeys.core.proposalPage(0, 20)).not.toEqual(
      queryKeys.core.proposalPage(1, 20),
    );
    expect(queryKeys.core.proposal("1")).not.toEqual(queryKeys.core.proposal("2"));
  });

  it("normalises addresses so casing cannot split the cache", () => {
    expect(queryKeys.admin.membership("0xABC")).toEqual(
      queryKeys.admin.membership("0xabc"),
    );
  });

  it("nests records under the collection prefix they belong to", () => {
    const proposalPage = queryKeys.core.proposalPage(0, 20);
    const proposal = queryKeys.core.proposal("7");
    const prefix = queryKeys.core.proposals();

    expect(proposalPage.slice(0, prefix.length)).toEqual([...prefix]);
    expect(proposal.slice(0, prefix.length)).toEqual([...prefix]);
  });
});

describe("invalidation", () => {
  function seededClient(): QueryClient {
    const client = new QueryClient();
    client.setQueryData(queryKeys.core.proposalPage(0, 20), {});
    client.setQueryData(queryKeys.core.proposal("1"), {});
    client.setQueryData(queryKeys.core.config(), {});
    client.setQueryData(queryKeys.core.historyPage(0, 20), {});
    client.setQueryData(queryKeys.admin.snapshot(), {});
    client.setQueryData(queryKeys.admin.action("ACTION-00000001"), {});
    client.setQueryData(queryKeys.core.actionApplied("ACTION-00000001"), {});
    return client;
  }

  it("invalidates the records a Core write could have changed", async () => {
    const client = seededClient();
    await invalidateAfterCoreWrite(client, { proposalId: 1n, actionId: "ACTION-00000001" });

    for (const key of [
      queryKeys.core.proposalPage(0, 20),
      queryKeys.core.proposal("1"),
      queryKeys.core.config(),
      queryKeys.core.historyPage(0, 20),
      queryKeys.core.actionApplied("ACTION-00000001"),
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("does not touch the constitution when a Core write cannot change it", async () => {
    const client = seededClient();
    client.setQueryData(queryKeys.core.constitutionVersion("1"), {});

    await invalidateAfterCoreWrite(client, { proposalId: 1n });

    expect(
      client.getQueryState(queryKeys.core.constitutionVersion("1"))?.isInvalidated,
    ).toBe(false);
  });

  it("invalidates the constitution when the write could advance its version", async () => {
    const client = seededClient();
    client.setQueryData(queryKeys.core.constitutionVersion("1"), {});

    await invalidateAfterCoreWrite(client, { constitutionChanged: true });

    expect(
      client.getQueryState(queryKeys.core.constitutionVersion("1"))?.isInvalidated,
    ).toBe(true);
  });

  it("keeps stewardship and governance caches separate", async () => {
    const client = seededClient();
    await invalidateAfterAdminWrite(client, {
      actionId: "ACTION-00000001",
      touchesCore: true,
    });

    expect(client.getQueryState(queryKeys.admin.snapshot())?.isInvalidated).toBe(true);
    // The action records and active-action pages sit under the actions prefix.
    expect(
      client.getQueryState(queryKeys.admin.action("ACTION-00000001"))?.isInvalidated,
    ).toBe(true);
    // A Core proposal collection must not be invalidated by a stewardship write.
    expect(
      client.getQueryState(queryKeys.core.proposalPage(0, 20))?.isInvalidated,
    ).toBe(false);
  });
});

