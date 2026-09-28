import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  ENV_KEYS,
  inspectRuntimeConfig,
  parseRuntimeConfig,
} from "./env";

const VALID = {
  [ENV_KEYS.network]: "studionet",
  [ENV_KEYS.coreAddress]: "0x008e2FC1D7B998587b9aF95E1D6081716d704235",
  [ENV_KEYS.adminAddress]: "0xf85b2e784c984Dc456C2827e321cC7C26320df84",
  [ENV_KEYS.fixtures]: "false",
};

describe("parseRuntimeConfig", () => {
  it("accepts a complete, valid configuration", () => {
    const config = parseRuntimeConfig(VALID);

    expect(config.network).toBe("studionet");
    expect(config.coreAddress).toBe(VALID[ENV_KEYS.coreAddress]);
    expect(config.adminAddress).toBe(VALID[ENV_KEYS.adminAddress]);
    expect(config.fixturesEnabled).toBe(false);
  });

  it("defaults fixture mode to false when the variable is absent", () => {
    const config = parseRuntimeConfig({
      [ENV_KEYS.network]: "studionet",
      [ENV_KEYS.coreAddress]: VALID[ENV_KEYS.coreAddress],
      [ENV_KEYS.adminAddress]: VALID[ENV_KEYS.adminAddress],
    });

    expect(config.fixturesEnabled).toBe(false);
  });

  it("reports every missing variable at once", () => {
    expect(() => parseRuntimeConfig({})).toThrowError(ConfigurationError);

    try {
      parseRuntimeConfig({});
      expect.unreachable("expected a ConfigurationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const issues = (error as ConfigurationError).issues;
      expect(issues).toHaveLength(3);
      expect(issues.join("\n")).toContain(ENV_KEYS.coreAddress);
      expect(issues.join("\n")).toContain(ENV_KEYS.adminAddress);
      expect(issues.join("\n")).toContain(ENV_KEYS.network);
    }
  });

  it("rejects an unsupported network preset", () => {
    expect(() =>
      parseRuntimeConfig({ ...VALID, [ENV_KEYS.network]: "mainnet" }),
    ).toThrowError(/not a supported network preset/);
  });

  it("rejects a malformed contract address", () => {
    expect(() =>
      parseRuntimeConfig({ ...VALID, [ENV_KEYS.coreAddress]: "0xabc" }),
    ).toThrowError(/not a valid 20-byte hex address/);
  });

  it("rejects the zero address, which is never a deployment", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID,
        [ENV_KEYS.adminAddress]: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrowError(/zero address/);
  });

  it("rejects a non-boolean fixture flag", () => {
    expect(() =>
      parseRuntimeConfig({ ...VALID, [ENV_KEYS.fixtures]: "yes" }),
    ).toThrowError(/expected "true" or "false"/);
  });
});

describe("inspectRuntimeConfig", () => {
  it("returns a result object instead of throwing", () => {
    const invalid = inspectRuntimeConfig({});
    expect(invalid.ok).toBe(false);

    const valid = inspectRuntimeConfig(VALID);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.config.network).toBe("studionet");
    }
  });
});
