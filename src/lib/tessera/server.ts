/**
 * Server entry of the Tessera engine (docs/contracts/service-api.md, module
 * map). Server Components, Server Actions and route handlers import this file
 * and nothing else from the engine: it re-exports the whole public surface of
 * `./index`, adds the process-wide database handles and two helpers that run a
 * function as the human user. The "server-only" guard makes Next fail the
 * build when a client component pulls it in. Vitest and scripts never load
 * this file (the guard throws under plain Node); they use `./index` and
 * `./db/client` directly.
 */
import "server-only";
import { USER_ACTOR_ID } from "./actors";
import { createContext, type TesseraContext } from "./core/context";
import { withTx } from "./core/tx";
import { getDb } from "./db/client";

export * from "./index";
export { closeDb, getDb } from "./db/client";

/** Context for the human user over the app database. */
function userContext(): TesseraContext {
  const { db, sqlite } = getDb();
  return createContext({ db, sqlite, actorId: USER_ACTOR_ID });
}

/**
 * Runs a read as the user, outside any transaction (reads never open one).
 * `fn` may be async so a page can await several engine calls in one go.
 */
export async function readTessera<T>(fn: (ctx: TesseraContext) => T | Promise<T>): Promise<T> {
  return fn(userContext());
}

/**
 * Runs a mutation as the user inside one BEGIN IMMEDIATE transaction.
 * `fn` must be synchronous: better-sqlite3 transactions commit when the
 * callback returns, so an async callback would commit before its body ran.
 */
export async function writeTessera<T>(fn: (ctx: TesseraContext) => T): Promise<T> {
  return withTx(userContext(), fn);
}
