/**
 * Tessera engine barrel. Everything exported here is safe for Vitest and tsx
 * (no "server-only"). Next server code imports "@/lib/tessera/server" instead,
 * which re-exports this module and adds getDb().
 *
 * P0: types and schemas only. The P1 engine lane adds core/, db/, the domain
 * modules and the tool registry (see docs/contracts/service-api.md).
 */
export * from "./types";
export * from "./schemas";
