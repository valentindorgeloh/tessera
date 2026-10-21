/**
 * Wording of the page activity rows in the history dialog's Activity tab
 * (decision 99). Pure, so Vitest covers it (tests/ui/page-activity.test.ts).
 * `history.activity` rows carry only verb and field (the engine's page writes,
 * src/lib/tessera/pages), so the text names what changed, not the values. The
 * result is the fragment after the actor's name: "renamed the page".
 */
import type { HistoryActivity } from "@/lib/tessera/types";

/** What each `updated` field of a page means to a reader. */
const UPDATED_FIELDS: Record<string, string> = {
  name: "renamed the page",
  access: "changed who can see the page",
  logo: "changed the page icon",
  labels: "changed the labels",
  parent: "moved the page",
  project: "moved the page to another space",
};

export function describePageActivity(entry: Pick<HistoryActivity, "verb" | "field">): string {
  switch (entry.verb) {
    case "created":
      return "created the page";
    case "updated":
      return (entry.field !== null ? UPDATED_FIELDS[entry.field] : undefined) ?? (entry.field === null ? "updated the page" : `changed ${entry.field.replace(/_/g, " ")}`);
    case "description":
      return "edited the body";
    case "restored":
      return "restored an earlier version";
    case "locked":
      return "locked the page";
    case "unlocked":
      return "unlocked the page";
    case "archived":
      return "archived the page";
    case "unarchived":
      return "restored the page from the archive";
    case "deleted":
      return "deleted the page";
    default:
      return entry.field === null ? entry.verb : `${entry.verb} ${entry.field.replace(/_/g, " ")}`;
  }
}

/** The actor's name, or "Unknown" for an id with no row (a removed agent) or while the actor list has not loaded. */
export function activityActorName(actorId: string, names: ReadonlyMap<string, string>): string {
  return names.get(actorId) ?? "Unknown";
}
