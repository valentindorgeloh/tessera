/**
 * Pure helpers for Home (docs/drafts/p9-plan.md U1). The shapes mirror the
 * engine views the home read will return. Phrases for "since you were last
 * here" come from the detail activity wording.
 */
import { describeActivity, linkDisplayLabel } from "@/components/detail/activity-text";
import { HOME_WIDGET_IDS, PaletteColorSchema } from "@/lib/tessera/schemas";
import type { HomeSummary, HomeWidgetId, QuickLinkView, SinceEntry, StickyView, YourWorkNumbers } from "@/lib/tessera/types";

export type { HomeSummary, HomeWidgetId, QuickLinkView, SinceEntry, StickyView, YourWorkNumbers };

export type SinceLastVisit = HomeSummary["since"];

export const HOME_WIDGET_LABELS: Record<HomeWidgetId, string> = {
  since_last_visit: "Since you were last here",
  quick_links: "Quick links",
  recents: "Recent",
  your_work: "Your work",
  stickies: "Stickies",
};

export type HomeWidgetSetting = { widget: HomeWidgetId; enabled: boolean };

const FIELD_WORDS: Record<string, string> = {
  name: "title",
  description_md: "description",
  state_id: "state",
  priority: "priority",
  sort_order: "position",
  parent_id: "parent",
  cycle_id: "cycle",
  project_id: "project",
  start_date: "start date",
  target_date: "target date",
};

export function isHomeWidgetId(value: string): value is HomeWidgetId {
  return (HOME_WIDGET_IDS as readonly string[]).includes(value);
}

/** The five widgets, in the stored order, with any missing id appended and shown. */
export function editableWidgets(widgets: readonly { widget: string; enabled: boolean }[]): HomeWidgetSetting[] {
  const seen = new Set<string>();
  const kept: HomeWidgetSetting[] = [];
  for (const item of widgets) {
    if (!isHomeWidgetId(item.widget) || seen.has(item.widget)) continue;
    seen.add(item.widget);
    kept.push({ widget: item.widget, enabled: item.enabled });
  }
  for (const widget of HOME_WIDGET_IDS) {
    if (!seen.has(widget)) kept.push({ widget, enabled: true });
  }
  return kept;
}

/** Swaps an item with its neighbour. Out of range returns a copy of the same order. */
export function moveWidget<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  const current = items[index];
  const other = items[target];
  if (current === undefined || other === undefined) return [...items];
  const next = [...items];
  next[index] = other;
  next[target] = current;
  return next;
}

export function fieldWords(field: string): string {
  return FIELD_WORDS[field] ?? field.replace(/_id$/, "").replace(/_/g, " ");
}

/** The activity fragment after the actor's name, from the detail wording. */
export function sinceVerbPhrase(entry: Pick<SinceEntry, "verbs" | "fields" | "count" | "target">): string {
  const phrase = describeActivity({
    entity_type: entry.target.type,
    verb: entry.verbs[0] ?? "updated",
    field: entry.fields[0] ?? null,
    old_value: null,
    new_value: null,
    old_identifier: null,
    new_identifier: null,
    merged_count: entry.count,
  });
  const extra = entry.verbs.length - 1;
  if (extra <= 0) return phrase;
  const more = extra === 1 ? "1 more change" : `${extra} more changes`;
  return `${phrase} (${more})`;
}

/** "<actor> <verb phrase> <target>", with "this work item" replaced by the target's name. */
export function sinceRowLabel(entry: SinceEntry): string {
  const phrase = sinceVerbPhrase(entry);
  const named = phrase.split("this work item").join(entry.target.label);
  if (named !== phrase) return `${entry.actor.name} ${named}`;
  return `${entry.actor.name} ${phrase} ${entry.target.label}`;
}

/** Fields that changed, then how many rows collapsed into the entry. */
export function sinceDescription(fields: readonly string[], count: number): string {
  const words = [...new Set(fields.map(fieldWords))];
  const times = count === 1 ? "1 change" : `${count} changes`;
  return words.length === 0 ? times : `${words.join(", ")} · ${times}`;
}

export function isIsoTimestamp(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

/** http(s) URL, or an app path. `//host` and other schemes are rejected. */
export function isQuickLinkUrl(value: string): boolean {
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return !/\s/.test(url);
  if (/\s/.test(url) || !/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isExternalQuickLink(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Title, else the host of an absolute URL, else the path. */
export function quickLinkLabel(link: { title: string; url: string }): string {
  return linkDisplayLabel({ title: link.title.trim(), url: link.url.trim() });
}

/**
 * The line under a quick link's title: the host of an absolute URL, the path of
 * an internal one. A link without a title already shows that text as its title,
 * so the line then names where it points (the address without its scheme, or
 * "In Tessera").
 */
export function quickLinkSupporting(link: { title: string; url: string }): string {
  const url = link.url.trim();
  const hasTitle = link.title.trim() !== "";
  if (!isExternalQuickLink(url)) return hasTitle ? url : "In Tessera";
  const address = url.replace(/^https?:\/\//i, "");
  if (!hasTitle) return address;
  try {
    return new URL(url).host;
  } catch {
    return address;
  }
}

/** Id of a tool result, when the engine returned an entity. */
export function entityId(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("id" in data)) return null;
  const id = data.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Sequence from `{ seq }` for the home beacon and Mark as seen. */
export function parseHomeSeenSeq(body: unknown): number | null {
  if (typeof body !== "object" || body === null || !("seq" in body)) return null;
  const seq = body.seq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return null;
  return seq;
}

const PALETTE = new Set<string>(PaletteColorSchema.options);

export function stickyColorClass(color: string): string {
  const key = PALETTE.has(color) ? color : "yellow";
  return `tessera-sticky tessera-sticky--${key}`;
}

/** First readable line of a sticky, for the home preview. */
export function stickyPreview(markdown: string): string {
  const line = markdown
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row !== "" && !row.startsWith("```"));
  if (line === undefined) return "";
  const plain = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
  return plain.length > 160 ? `${plain.slice(0, 157)}…` : plain;
}

export function stickyTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? "Untitled sticky" : trimmed;
}
