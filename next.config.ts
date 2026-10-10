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
