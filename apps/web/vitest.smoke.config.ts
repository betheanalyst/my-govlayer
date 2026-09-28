import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Live smoke-test configuration (Frontend Foundation Standard section 10).
 * Runs only `*.live.test.ts` files against the real deployed GovLayerCore and
 * GovLayerAdmin contracts and the real Studionet RPC. Requires a populated
 * `.env.local`; see `vitest.smoke.setup.ts`.
 *
 * This suite is intentionally serial and slow-tolerant: it talks to a live
 * network, and its job is to prove connectivity, address handling, and
 * BigInt/value handling -- not to be a fast unit gate.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    setupFiles: ["./vitest.smoke.setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
