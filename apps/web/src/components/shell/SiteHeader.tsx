"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GovLayerMark } from "@/components/brand/GovLayerMark";
import { ConnectWallet } from "@/wallet/ConnectWallet";
import { cn } from "@/lib/cn";

/**
 * Primary navigation (Experience Blueprint section 7):
 * GovLayer | How it works | Explore | Constitution | Verify | My governance
 *
 * Browsing remains wallet-free: the connection control is a single quiet button,
 * never a gate in front of the product. `My governance` is a connected-user
 * surface, so it states its wallet requirement inside rather than hiding itself.
 */

const NAV_ITEMS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/explore", label: "Explore" },
  { href: "/constitution", label: "Constitution" },
  { href: "/verify", label: "Verify" },
  { href: "/stewardship", label: "Stewardship" },
  { href: "/governance/me", label: "My governance" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-shell flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-card text-ink"
          aria-label="GovLayer home"
        >
          <GovLayerMark className="h-7 w-7 text-ink" />
          <span className="font-display text-lg tracking-tight">GovLayer</span>
        </Link>

        <nav aria-label="Primary">
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "rounded-card text-sm transition-colors duration-state",
                      isActive
                        ? "font-medium text-ink underline decoration-line-strong decoration-2 underline-offset-8"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <ConnectWallet />
      </div>
    </header>
  );
}
