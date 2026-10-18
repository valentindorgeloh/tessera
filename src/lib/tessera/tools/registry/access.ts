/**
 * Agent access, checked once before a tool runs. `userOnly` tools refuse
 * non-user actors first. `read` may not mutate. `intake` may create work and
 * intake items, and may call self-scoped tools.
 */
import type { TesseraContext } from "../../core/context";
import { rule } from "../../core/errors";
import type { ToolDef } from "../define";

const INTAKE_TOOLS = new Set(["create_work_item", "create_intake_item"]);

export function assertToolAllowed(ctx: TesseraContext, def: ToolDef): void {
  if (def.userOnly === true && ctx.actor.kind !== "user") {
    throw rule("user_only", "Only the user can run this tool");
  }
  if (ctx.actor.kind !== "agent") return;
  if (ctx.actor.access === "write" || def.selfScoped === true) return;
  if (!def.mutates) return;
  if (ctx.actor.access === "read") throw rule("actor_read_only", "This agent is read-only");
  if (INTAKE_TOOLS.has(def.name)) return;
  throw rule("actor_intake_only", "This agent can only submit work to Intake");
}
