import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  devIndicators: {
    position: "bottom-right",
  },
  turbopack: {
    // Pin the root so a stray lockfile in a parent folder never changes module resolution.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
