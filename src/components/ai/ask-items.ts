/**
 * Items of the Power K "Ask" mode (docs/drafts/p5-plan.md §6 "U3", decision 38):
 * "Ask: <query>" while the input holds text, and up to three contextual
 * suggestions while it is empty. Selecting one closes the palette and hands
 * the text to the assistant panel (`useAssistant().ask`); the palette itself
 * never chats. Pure: the command bar passes the pathname it opened on.
 */
import { projectIdFromPath } from "@/components/shell/recents";
import type { CommandSearchItem } from "@/components/shell/command-source";

/** `AssistMessageSchema` caps a turn at 20,000 characters; a longer query is cut to fit. */
export const ASK_MAX_LENGTH = 20000;

export const ASK_PREFIX = "ask:";

export const ASK_NEXT = "What should I work on next?";
export const ASK_CHANGED = "What changed this week?";
export const ASK_CYCLE = "Summarise this cycle";
export const ASK_MODULE = "Summarise this module";

/** The cycle or module a `/projects/<id>/{cycles|modules}/<entityId>` path shows, else null. */
function detailKind(pathname: string): "cycle" | "module" | null {
  if (projectIdFromPath(pathname) === null) return null;
  const [root, , section, entityId] = pathname.split("/").filter(Boolean);
  if (root !== "projects" || !entityId) return null;
  if (section === "cycles") return "cycle";
  if (section === "modules") return "module";
  return null;
}

/**
 * The suggestions for the route the palette opened on, most specific first:
 * a cycle (or module) adds its summary, a project adds "What changed this
 * week?", and "What should I work on next?" closes every list. At most three.
 */
export function askSuggestions(pathname: string): string[] {
  const out: string[] = [];
  const kind = detailKind(pathname);
  if (kind === "cycle") out.push(ASK_CYCLE);
  if (kind === "module") out.push(ASK_MODULE);
  if (projectIdFromPath(pathname) !== null) out.push(ASK_CHANGED);
  out.push(ASK_NEXT);
  return out.slice(0, 3);
}

function toItem(text: string, label: string): CommandSearchItem {
  return { id: `${ASK_PREFIX}${text}`, label, auxiliaryData: { group: "Ask", kind: "ask", text } };
}

/**
 * The palette items for `query` on `pathname`. A non-empty query gives the one
 * "Ask: <query>" item (its label contains the query, so the palette's own
 * narrowing keeps it); an empty one gives the suggestions.
 */
export function askItems(query: string, pathname: string): CommandSearchItem[] {
  const text = query.trim().slice(0, ASK_MAX_LENGTH);
  if (text !== "") return [toItem(text, `Ask: ${text}`)];
  return askSuggestions(pathname).map((suggestion) => toItem(suggestion, suggestion));
}
