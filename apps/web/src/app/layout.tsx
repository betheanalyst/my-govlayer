import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { QueryProvider } from "@/queries/QueryProvider";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { WalletProvider } from "@/wallet/WalletProvider";
import "./globals.css";

/**
 * Type pairing (Experience Blueprint sections 17, 18, 22):
 *   - display: an editorial serif with personality, for the product's voice;
 *   - interface: a highly legible modern sans.
 * Deliberately not a cryptographic/futuristic pairing, and deliberately not a
 * courthouse/legal cliche.
 */
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GovLayer",
  description:
    "GovLayer is a governance system in which a proposal must first demonstrate constitutional compliance before the community decides whether it should pass.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>
        <QueryProvider>
          <WalletProvider>
            <SiteHeader />
            <div id="main" className="flex-1">
              {children}
            </div>
            <SiteFooter />
          </WalletProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
