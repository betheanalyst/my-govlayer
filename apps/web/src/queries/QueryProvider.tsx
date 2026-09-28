"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { DEFAULT_GC_TIME, STALE_TIME, shouldRetryRead } from "./policy";

/**
 * React Query provider (Foundation Standard section 2.7).
 *
 * The client is created once per browser session. Window-focus refetching is
 * disabled deliberately: this app reads a public RPC whose results change on
 * governance events, not on tab switches, so refetching on focus would only add
 * RPC load without adding freshness.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: STALE_TIME.proposals,
            gcTime: DEFAULT_GC_TIME,
            refetchOnWindowFocus: false,
            retry: shouldRetryRead,
          },
          mutations: {
            // Writes are user-intent transactions: never retried automatically.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
