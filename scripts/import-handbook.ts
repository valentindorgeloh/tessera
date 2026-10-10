/**
 * `npm run import:handbook`: placeholder until the handbook import into Pages
 * ships in P6. Loads .env.local and resolves the database path like every
 * other script so the wiring is in place.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDbPath } from "@/lib/tessera/db/client";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

console.log(`Database: ${resolveDbPath()}`);
console.log("Handbook import arrives in P6 (docs/PLAN.md)");
process.exitCode = 0;
