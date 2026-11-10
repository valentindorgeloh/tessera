/**
 * Server side of the superagent setup guide's status block (decision 155; docs/contracts/ui.md
 * "Superagent control", "Setup guide"). Reads what the guide can check: the runner's token file
 * (whether it is there and owner-only, never its content), `GET /v1/state`, the live mapped
 * projects and the `mcp:superagent` actor. A runner failure is a state in `state`, never thrown;
 * a Tessera error propagates like on every other screen. Used by the setup page only.
 */
import "server-only";
import { stat } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { actor, getWorkspaceSettings, listProjects, readTessera } from "@/lib/tessera/server";
import { connectRunner } from "./server";
import { SUPERAGENT_ACTOR_NAME, type ChatProject, type SuperagentSetupLoad, type TokenFileStatus } from "./types";

/** True when the file has no group or other permission bits (the runner's doctor wants mode 600); null when the mode cannot be read. Reads the mode only. */
async function isOwnerOnly(file: string): Promise<boolean | null> {
  try {
    return ((await stat(file)).mode & 0o077) === 0;
  } catch {
    return null;
  }
}

export async function loadSuperagentSetup(): Promise<SuperagentSetupLoad> {
  const { runnerUrl, tokenFile, client } = await connectRunner();
  const [state, own, isPrivate] = await Promise.all([
    client.ok ? client.data.getState() : Promise.resolve(null),
    // The same reads as chat.ts; kept apart so the chat loader stays unchanged.
    readTessera((ctx) => {
      const mapped = getWorkspaceSettings(ctx).agents?.projects ?? [];
      const live = new Map(listProjects(ctx, {}).map((project) => [project.id, project]));
      const mappedProjects = mapped.flatMap((entry): ChatProject[] => {
        const project = live.get(entry.project_id);
        return project ? [{ id: project.id, name: project.name, identifier: project.identifier, repo: entry.repo }] : [];
      });
      const superagent = ctx.db
        .select({ id: actor.id })
        .from(actor)
        .where(and(eq(actor.kind, "agent"), eq(actor.name, SUPERAGENT_ACTOR_NAME), isNull(actor.deleted_at)))
        .get();
      return { mappedProjects, isConnected: superagent !== undefined };
    }),
    client.ok ? isOwnerOnly(tokenFile) : Promise.resolve(null),
  ]);
  const token: TokenFileStatus = client.ok
    ? { kind: "found", isPrivate }
    : client.failure.state === "not_set_up"
      ? { kind: "missing" }
      : { kind: "unreadable", message: client.failure.message };
  return { runnerUrl, tokenFile, token, state, mappedProjects: own.mappedProjects, isConnected: own.isConnected };
}
