import path from "node:path";
import type { NextConfig } from "next";

// better-sqlite3 13 needs Node-API 10 (Node >= 22.14); older Node 22 builds crash when the engine loads.
const napi = Number(process.versions.napi ?? 0);
if (napi < 10) {
  throw new Error(
    `Tessera needs Node >= 22.14 (Node-API 10); this is Node ${process.version} (Node-API ${napi}). ` +
      "Run `source ~/.nvm/nvm.sh && nvm use` or put a newer node first on PATH (e.g. /opt/homebrew/bin).",
  );
}

const nextConfig: NextConfig = {
  // decision 140: scripts/live.sh builds into .next-build and serves each release's .next-r. A build in its own
  // folder never disturbs a dev server's .next (docs: next-config-js/distDir).
  distDir: process.env.TESSERA_DIST_DIR || ".next",
  typescript: {
    // decision 140: a build in its own folder type-checks src only (`npm run check` already checked the tests) with
    // tsconfig.build.json. It extends tsconfig.json, so Next never adds that folder's types to the tracked
    // tsconfig.json (docs: typescript "Custom tsconfig path").
    tsconfigPath: process.env.TESSERA_LIVE_BUILD === "1" || process.env.TESSERA_DIST_DIR ? "tsconfig.build.json" : "tsconfig.json",
  },
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [{ source: "/home", destination: "/", permanent: true }];
  },
  devIndicators: {
    position: "bottom-right",
  },
  turbopack: {
    // Pin the root so a stray lockfile in a parent folder never changes module resolution.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
