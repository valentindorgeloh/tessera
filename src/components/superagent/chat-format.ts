/**
 * Pure helpers of the superagent chat screen (decision 153; docs/contracts/ui.md
 * "Superagent chat"): the chat's address, the title a first message gives its
 * work item, who a bubble names, and the composer's runner status line.
 */
import { SUPERAGENT_ACTOR_NAME, SUPERAGENT_CHAT_PATH, type ChatConversation, type ChatEntry, type RunnerResult } from "@/lib/superagent/types";
import { failureCopy, type FailureContext } from "./superagent-format";

/** How often the chat reloads itself while it is visible (Tessera's own writes arrive through ChangesPoller). */
export const CHAT_REFRESH_INTERVAL_MS = 5_000;

/** The longest title a chat's first message gives its work item. */
export const CHAT_TITLE_MAX = 80;

/** The title of a chat whose first message has no text to take one from. */
export const CHAT_TITLE_FALLBACK = "Chat with the superagent";

/** `/agents/superagent/chat/<KEY>`; the key is URL-encoded. */
export function chatHref(itemKey: string): string {
  return `${SUPERAGENT_CHAT_PATH}/${encodeURIComponent(itemKey)}`;
}

/**
 * The work item title for a chat's first message: its first line with text,
 * without leading Markdown markers (`#`, `>`, `-`, `*`), clipped to 80
 * characters at the last space before 80 when there is one, plus an ellipsis.
 */
export function chatTitle(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== "");
  const title = (line ?? "").replace(/^[#>*\-\s]+/, "").trim();
  if (title === "") return CHAT_TITLE_FALLBACK;
  if (title.length <= CHAT_TITLE_MAX) return title;
  const head = title.slice(0, CHAT_TITLE_MAX);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** The name a bubble shows: "Superagent" for the superagent actor, else the actor's own name. */
export function entryName(entry: Pick<ChatEntry, "actorId" | "actorName">, superagentActorId: string | null): string {
  return superagentActorId !== null && entry.actorId === superagentActorId ? "Superagent" : entry.actorName;
}

/** A list row's second line: "{name}: {snippet}" of the newest message, or "No messages yet". The row carries the actor's name only, so the superagent is told by its actor name. */
export function lastMessageLine(lastMessage: ChatConversation["lastMessage"]): string {
  if (lastMessage === null) return "No messages yet";
  return `${lastMessage.actorName === SUPERAGENT_ACTOR_NAME ? "Superagent" : lastMessage.actorName}: ${lastMessage.snippet}`;
}

export type ComposerStatus = { type: "warning"; message: string };

const OFFLINE_STATES: readonly string[] = ["unreachable", "timeout", "unavailable"];

/** The composer's line under the input: null while the runner's list loaded; a message still goes to Tessera when it did not. */
export function composerStatus(requests: RunnerResult<unknown>, context: FailureContext): ComposerStatus | null {
  if (requests.ok) return null;
  if (OFFLINE_STATES.includes(requests.failure.state)) return { type: "warning", message: "Runner offline. It will read this when it's back." };
  return { type: "warning", message: `${failureCopy(requests.failure, context).title}. The runner reads this once it is running.` };
}
