import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// better-sqlite3 13 is built against Node-API 10; older Node 22 builds segfault inside every worker.
// Fail here with a readable message instead.
const napi = Number(process.versions.napi ?? 0);
if (napi < 10) {
  throw new Error(
    `Tessera needs Node >= 22.14 (Node-API 10); this is Node ${process.version} (Node-API ${napi}). ` +
      "Run `source ~/.nvm/nvm.sh && nvm use` or put a newer node first on PATH (e.g. /opt/homebrew/bin).",
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
