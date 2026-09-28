import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit test configuration. Live-network tests (`*.live.test.ts`) are excluded
 * here and run through `vitest.smoke.config.ts` instead, so the default suite
 * stays deterministic and offline.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
  },
});
