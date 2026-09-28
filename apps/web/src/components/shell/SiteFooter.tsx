import Link from "next/link";
import { GovLayerMark } from "@/components/brand/GovLayerMark";
import { inspectRuntimeConfig } from "@/config/env";
import { primaryRpcUrl, resolveNetwork } from "@/config/network";

/**
 * Site footer.
 *
 * Deliberately free of contract reads: it shows only configuration values (the
 * network preset and the two deployed addresses), so it costs no RPC traffic on
 * any page. Live protocol state belongs to the surfaces that actually use it.
 *
 * When configuration is missing or malformed, the footer says so instead of
 * showing invented addresses.
 */
export function SiteFooter() {
  const inspected = inspectRuntimeConfig();

  return (
    <footer className="mt-24 border-t border-line bg-surface-sunken">
      <div className="mx-auto grid max-w-shell gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2.5 text-ink">
            <GovLayerMark className="h-6 w-6" />
            <span className="font-display text-base tracking-tight">GovLayer</span>
          </div>
          <p className="mt-4 max-w-prose text-sm text-ink-muted">
            A governance system in which a proposal must first demonstrate
            constitutional compliance before the community decides whether it
            should pass.
          </p>
        </div>

        <nav aria-label="Footer">
          <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Understand
          </h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link href="/how-it-works" className="text-ink-muted hover:text-ink">
                How it works
              </Link>
            </li>
            <li>
              <Link href="/explore" className="text-ink-muted hover:text-ink">
                Explore governance
              </Link>
            </li>
            <li>
              <Link href="/constitution" className="text-ink-muted hover:text-ink">
                Constitution
              </Link>
            </li>
            <li>
              <Link href="/verify" className="text-ink-muted hover:text-ink">
                Verify a record
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Protocol
          </h2>
          {inspected.ok ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-ink-subtle">Network</dt>
                <dd className="code-value">
                  {resolveNetwork(inspected.config.network).label}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">RPC</dt>
                <dd className="code-value break-all">
                  {primaryRpcUrl(resolveNetwork(inspected.config.network))}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">GovLayerCore</dt>
                <dd className="code-value break-all">
                  {inspected.config.coreAddress}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">GovLayerAdmin</dt>
                <dd className="code-value break-all">
                  {inspected.config.adminAddress}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">
              Configuration is incomplete, so no deployment addresses are shown.
              Addresses are never invented or defaulted.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-line">
        <p className="mx-auto max-w-shell px-6 py-6 text-xs text-ink-subtle">
          Every protocol value in this interface is read from GovLayerCore or
          GovLayerAdmin. Outcomes are never predicted, and activity that the
          contracts do not record is never displayed.
        </p>
      </div>
    </footer>
  );
}
