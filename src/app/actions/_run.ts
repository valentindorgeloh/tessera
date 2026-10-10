/**
 * Server Action runner (docs/contracts/tools.md, "Server Actions"): the one
 * place where the UI reaches the tool registry. `runTool` is the Server
 * Action; `toolAction(name)` builds the typed wrappers the per-domain
 * `actions/<domain>.ts` files export.
 *
 * The "use server" directive sits on `runTool` rather than on the file: Next
 * only allows async functions as exports of a "use server" file, and
 * `toolAction` must be a synchronous factory. Client components import the
 * per-domain wrappers, never this file, so the engine stays out of client
 * bundles.
 */
import { refresh } from "next/cache";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { fromSqliteError, isTrackerError, validateInput } from "@/lib/tessera/core/errors";
import { getDb } from "@/lib/tessera/db/client";
import { getTool, runToolWithContext, type ToolInput, type ToolName, type ToolOutput } from "@/lib/tessera/tools/registry";
import type { TrackerErrorCode } from "@/lib/tessera/types";

export type ActionFailure = {
  ok: false;
  /** A TrackerError code, or INTERNAL for anything the engine did not classify. */
  code: TrackerErrorCode | "INTERNAL";
  message: string;
  details?: unknown;
};

export type ActionSuccess<T> = { ok: true; data: T; cursor: number };

export type ActionResult<T = unknown> = ActionSuccess<T> | ActionFailure;

function failure(err: unknown): ActionFailure {
  const mapped = fromSqliteError(err);
  if (isTrackerError(mapped)) {
    return { ok: false, code: mapped.code, message: mapped.message, details: mapped.details };
  }
  // Unknown errors are logged server-side; the client only learns that the call failed.
  console.error("[tessera] tool run failed", mapped);
  return { ok: false, code: "INTERNAL", message: mapped instanceof Error ? mapped.message : "Unexpected error" };
}

/**
 * Runs a registry tool as `actorId` (the user by default) against the app
 * database. Never throws to the client: tool errors come back as
 * `{ ok: false }`. After a mutating tool it calls `refresh()` so the open page
 * re-renders; read tools skip it.
 */
export async function runTool(name: string, input: unknown, actorId: string = USER_ACTOR_ID): Promise<ActionResult> {
  "use server";
  let result: ActionResult;
  let mutates = false;
  try {
    const def = getTool(name);
    mutates = def.mutates;
    // Validate before touching the database so a bad payload never opens a connection.
    const data = validateInput(def.input, input);
    const { db, sqlite } = getDb();
    const ctx = createContext({ db, sqlite, actorId });
    const run = await runToolWithContext(ctx, name, data);
    result = { ok: true, data: run.data, cursor: run.cursor };
  } catch (err) {
    return failure(err);
  }
  // Outside the try: a refresh() misuse (outside a Server Action) must surface, not masquerade as a tool failure.
  if (mutates) refresh();
  return result;
}

/**
 * Typed wrapper for one tool, for `export const moveWorkItemAction = toolAction("move_work_item")`
 * in a "use server" file. The input type is the tool's zod input; the result carries the tool's output type.
 */
export function toolAction<N extends ToolName>(name: N): (input: ToolInput<N>) => Promise<ActionResult<ToolOutput<N>>> {
  // Fail at module load, not on first click, when the name is wrong.
  getTool(name);
  return (input) => runTool(name, input) as Promise<ActionResult<ToolOutput<N>>>;
}
