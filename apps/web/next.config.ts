import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      {
        /**
         * The documented route structure lists `/proposals`, but no distinct
         * behaviour is specified for a bare proposal index that differs from
         * Explore. Rather than inventing a second listing surface with its own
         * rules, the documented URL resolves to the canonical collection.
         * Individual proposals live at `/proposals/:id`.
         */
        source: "/proposals",
        destination: "/explore",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
