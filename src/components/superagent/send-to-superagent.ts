/**
 * "Send to superagent" on a work item (decisions 150 and 151; docs/contracts/ui.md
 * "Send to superagent"). Pure: what the detail's More menu shows for an item,
 * from the project's mapped repository, its actors and the item's assignees.
 * The runner treats the superagent's assignment as the request, so sending is
 * assigning; an item the superagent already has opens its chat instead
 * (decision 152, "Navigation and send").
 */
import { SUPERAGENT_ACTOR_NAME } from "@/lib/superagent/types";
import type { ActorRow } from "@/lib/tessera/types";

export const SUPERAGENT_NOT_CONNECTED = "The superagent has not connected to Tessera yet.";

export type SendToSuperagentState =
  /** No row: the item is read-only or its project has no mapped repository. */
  | { kind: "hidden" }
  /** The row is shown disabled with `reason` as its description. */
  | { kind: "blocked"; reason: string }
  /** The superagent is already an assignee: the row reads "Open superagent chat" and navigates to the item's chat. */
  | { kind: "open" }
  /** The click assigns: `actorIds` are the current assignees plus the superagent. */
  | { kind: "ready"; repo: string; actorIds: string[] };

export type SendToSuperagentInput = {
  /** `bundle.superagent_repo`: the repository mapped to the item's project, null or undefined when none. */
  repo: string | null | undefined;
  /** `bundle.actors`: the project's live actors (`listActors` leaves deleted ones out). */
  actors: readonly Pick<ActorRow, "id" | "kind" | "name">[];
  assigneeIds: readonly string[];
  readOnly: boolean;
};

export function sendToSuperagentState({ repo, actors, assigneeIds, readOnly }: SendToSuperagentInput): SendToSuperagentState {
  if (readOnly || repo === null || repo === undefined) return { kind: "hidden" };
  const superagent = actors.find((actor) => actor.kind === "agent" && actor.name === SUPERAGENT_ACTOR_NAME);
  if (superagent === undefined) return { kind: "blocked", reason: SUPERAGENT_NOT_CONNECTED };
  if (assigneeIds.includes(superagent.id)) return { kind: "open" };
  return { kind: "ready", repo, actorIds: [...assigneeIds, superagent.id] };
}

/** The Toast after a send: "Sent to the superagent (tessera)." */
export function sentToSuperagentText(repo: string): string {
  return `Sent to the superagent (${repo}).`;
}
