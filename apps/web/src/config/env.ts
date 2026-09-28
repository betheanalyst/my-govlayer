/**
 * Runtime configuration: network preset, both contract addresses, fixture flag.
 *
 * Foundation Standard section 7 + section 9: configuration is supplied by
 * environment, never hardcoded, and a future network migration must be a
 * configuration change only. Missing or malformed configuration produces a
 * descriptive error -- there are no silent fallbacks and no invented addresses.
 *
 * Note on Next.js: `NEXT_PUBLIC_*` values are inlined at build time, so they
 * must be referenced as full literal member expressions rather than through
 * dynamic keys.
 */

export const SUPPORTED_NETWORKS = ["studionet"] as const;

export type GenLayerNetworkId = (typeof SUPPORTED_NETWORKS)[number];

export interface GovLayerRuntimeConfig {
  /** GenLayer network preset identifier. */
  network: GenLayerNetworkId;
  /** GovLayerCore contract address. */
  coreAddress: string;
  /** GovLayerAdmin contract address. */
  adminAddress: string;
  /**
   * Fixture mode. Reserved for isolated UI development; fixture values must
   * never be presented as live protocol values. Defaults to false.
   */
  fixturesEnabled: boolean;
}

export const ENV_KEYS = {
  network: "NEXT_PUBLIC_GENLAYER_NETWORK",
  coreAddress: "NEXT_PUBLIC_GOVLAYER_CORE_ADDRESS",
  adminAddress: "NEXT_PUBLIC_GOVLAYER_ADMIN_ADDRESS",
  fixtures: "NEXT_PUBLIC_ENABLE_FIXTURES",
} as const;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Raised when the environment does not describe a usable GovLayer deployment.
 * Carries every detected issue so the operator sees the complete picture in a
 * single report rather than fixing problems one failed run at a time.
 */
export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `GovLayer configuration is incomplete or malformed:\n` +
        issues.map((issue) => `  - ${issue}`).join("\n"),
    );
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

function readNetwork(
  source: Record<string, string | undefined>,
  issues: string[],
): GenLayerNetworkId {
  const raw = source[ENV_KEYS.network]?.trim() ?? "";

  if (raw === "") {
    issues.push(
      `${ENV_KEYS.network} is required (supported values: ${SUPPORTED_NETWORKS.join(", ")}).`,
    );
    return SUPPORTED_NETWORKS[0];
  }

  if (!(SUPPORTED_NETWORKS as readonly string[]).includes(raw)) {
    issues.push(
      `${ENV_KEYS.network} is "${raw}", which is not a supported network preset ` +
        `(supported values: ${SUPPORTED_NETWORKS.join(", ")}).`,
    );
    return SUPPORTED_NETWORKS[0];
  }

  return raw as GenLayerNetworkId;
}

function readAddress(
  source: Record<string, string | undefined>,
  key: string,
  label: string,
  issues: string[],
): string {
  const raw = source[key]?.trim() ?? "";

  if (raw === "") {
    issues.push(`${key} is required (${label} contract address).`);
    return "";
  }

  if (!ADDRESS_PATTERN.test(raw)) {
    issues.push(
      `${key} is not a valid 20-byte hex address: ${JSON.stringify(raw)} ` +
        `(${label} contract address).`,
    );
    return raw;
  }

  if (raw.toLowerCase() === ZERO_ADDRESS) {
    issues.push(
      `${key} is the zero address, which cannot be the ${label} contract ` +
        `address. Supply the real deployment address.`,
    );
  }

  return raw;
}

function readFixtures(
  source: Record<string, string | undefined>,
  issues: string[],
): boolean {
  const raw = source[ENV_KEYS.fixtures]?.trim().toLowerCase() ?? "";

  if (raw === "") return false;
  if (raw === "true") return true;
  if (raw === "false") return false;

  issues.push(
    `${ENV_KEYS.fixtures} is ${JSON.stringify(raw)}; expected "true" or "false" ` +
      `(or omitted, which defaults to false).`,
  );
  return false;
}



/**
 * Pure, testable parser. Collects every problem before throwing, so a
 * misconfigured deployment is diagnosable from a single report.
 */
export function parseRuntimeConfig(
  source: Record<string, string | undefined>,
): GovLayerRuntimeConfig {
  const issues: string[] = [];

  const network = readNetwork(source, issues);
  const coreAddress = readAddress(
    source,
    ENV_KEYS.coreAddress,
    "GovLayerCore",
    issues,
  );
  const adminAddress = readAddress(
    source,
    ENV_KEYS.adminAddress,
    "GovLayerAdmin",
    issues,
  );
  const fixturesEnabled = readFixtures(source, issues);

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return { network, coreAddress, adminAddress, fixturesEnabled };
}

/**
 * Reads configuration from the environment, referencing `NEXT_PUBLIC_*` keys
 * literally so Next.js can inline them.
 */
export function readEnvSource(): Record<string, string | undefined> {
  return {
    [ENV_KEYS.network]: process.env.NEXT_PUBLIC_GENLAYER_NETWORK,
    [ENV_KEYS.coreAddress]: process.env.NEXT_PUBLIC_GOVLAYER_CORE_ADDRESS,
    [ENV_KEYS.adminAddress]: process.env.NEXT_PUBLIC_GOVLAYER_ADMIN_ADDRESS,
    [ENV_KEYS.fixtures]: process.env.NEXT_PUBLIC_ENABLE_FIXTURES,
  };
}

export type RuntimeConfigResult =
  | { ok: true; config: GovLayerRuntimeConfig }
  | { ok: false; error: ConfigurationError };

/**
 * Non-throwing inspection, so the UI can render an honest
 * "configuration incomplete" state instead of failing obscurely.
 */
export function inspectRuntimeConfig(
  source: Record<string, string | undefined> = readEnvSource(),
): RuntimeConfigResult {
  try {
    return { ok: true, config: parseRuntimeConfig(source) };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return { ok: false, error };
    }
    throw error;
  }
}

let cached: GovLayerRuntimeConfig | undefined;

/** Throwing accessor for code paths that cannot proceed without configuration. */
export function getRuntimeConfig(): GovLayerRuntimeConfig {
  if (cached === undefined) {
    cached = parseRuntimeConfig(readEnvSource());
  }
  return cached;
}
