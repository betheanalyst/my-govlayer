import { studionet } from "genlayer-js/chains";
import type { GenLayerNetworkId } from "./env";

/**
 * Network resolution.
 *
 * Foundation Standard section 9: a network migration must be a configuration
 * change, not a rewrite. Adding a network means adding a preset here plus the
 * matching value in the environment; no component, adapter, or domain model
 * changes.
 *
 * The chain shape below is declared structurally rather than imported from
 * viem, because genlayer-js is the sole permitted blockchain dependency.
 */
export interface GenLayerChainLike {
  readonly id: number;
  readonly name: string;
  readonly rpcUrls: {
    readonly default: { readonly http: readonly string[] };
  };
  readonly nativeCurrency: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly blockExplorers?: {
    readonly default: { readonly name: string; readonly url: string };
  };
}

export interface NetworkPreset {
  readonly id: GenLayerNetworkId;
  readonly label: string;
  /** Chain object handed to the genlayer-js client factory. */
  readonly chain: GenLayerChainLike;
}

const PRESETS: Record<GenLayerNetworkId, NetworkPreset> = {
  studionet: {
    id: "studionet",
    label: "GenLayer Studionet",
    chain: studionet,
  },
};

export const AVAILABLE_NETWORKS: readonly NetworkPreset[] =
  Object.values(PRESETS);

export function resolveNetwork(id: GenLayerNetworkId): NetworkPreset {
  return PRESETS[id];
}

export function primaryRpcUrl(preset: NetworkPreset): string {
  return preset.chain.rpcUrls.default.http[0] ?? "";
}

/**
 * Reads the chain id from the network itself, so connectivity and network
 * identity are verified against the live endpoint rather than assumed.
 * Used by the foundation status surface and the live smoke test.
 */
export async function readChainId(
  preset: NetworkPreset,
  timeoutMs = 15_000,
): Promise<number> {
  const rpcUrl = primaryRpcUrl(preset);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RPC responded with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { result?: unknown };
    if (typeof payload.result !== "string") {
      throw new Error("RPC response did not contain a chain id");
    }

    return Number.parseInt(payload.result, 16);
  } finally {
    clearTimeout(timer);
  }
}
