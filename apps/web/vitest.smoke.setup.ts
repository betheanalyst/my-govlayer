import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal `.env.local` loader for the live smoke suite.
 *
 * The dependency standard excludes dotenv-style packages, so this reads the
 * file directly. Existing `process.env` values always win, so CI/Vercel
 * configuration is never overwritten by a local file. Configuration validity
 * is not asserted here: the application's own configuration validator reports
 * exactly what is missing or malformed.
 */
const envPath = resolve(process.cwd(), ".env.local");

try {
  const contents = readFileSync(envPath, "utf8");

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key !== "" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // A missing .env.local is a valid state; the configuration validator will
  // report the resulting missing-variable errors with full detail.
}
