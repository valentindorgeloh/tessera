/**
 * URL state of a work-items list (docs/contracts/ui.md "Work items screen"):
 * one `q` search param holding base64url JSON `{ filters?, display? }`.
 * Pure and client-safe: only zod schemas from the engine, no React, no Next.
 *
 * Layering happens on the server: defaults <- view_settings <- URL. The URL
 * therefore carries a sparse display patch: only the keys the viewer changed
 * in this session, and inside `properties` and `calendar` only the changed
 * keys too. `decodeUrlState` validates against default-free patch schemas
 * (the same shape as `DisplayPatchSchema` in the engine's view-settings.ts),
 * because zod fills `.default()` values for missing keys even under
 * `.partial()`, which would turn a one-key link into a full display and
 * silently override the saved settings.
 */
import { z } from "zod";
import {
  CalendarLayoutSchema,
  DisplayPropertiesSchema,
  DisplaySchema,
  FiltersSchema,
  GroupBySchema,
  RichFiltersSchema,
  LayoutSchema,
  OrderBySchema,
  SubGroupBySchema,
  WorkItemTypeFilterSchema,
} from "@/lib/tessera/schemas";
import type { Display, DisplayProperties, Filters } from "@/lib/tessera/types";
import type { UrlState } from "./types";

// Object.keys is typed string[]; the shape's keys are the property names.
const DISPLAY_PROPERTY_KEYS = Object.keys(DisplayPropertiesSchema.shape) as (keyof DisplayProperties)[];

const DisplayPropertiesPatchSchema = z.partialRecord(z.enum(DISPLAY_PROPERTY_KEYS), z.boolean());

const CalendarDisplayPatchSchema = z.object({
  layout: CalendarLayoutSchema.optional(),
  show_weekends: z.boolean().optional(),
});

/** Sparse display patch a link may carry; every key optional, no defaults. */
export const UrlDisplayPatchSchema = z.object({
  layout: LayoutSchema.optional(),
  group_by: GroupBySchema.nullable().optional(),
  sub_group_by: SubGroupBySchema.nullable().optional(),
  order_by: OrderBySchema.optional(),
  type: WorkItemTypeFilterSchema.optional(),
  show_empty_groups: z.boolean().optional(),
  sub_items: z.boolean().optional(),
  calendar: CalendarDisplayPatchSchema.optional(),
  properties: DisplayPropertiesPatchSchema.optional(),
});

const UrlStateSchema = z.object({
  filters: FiltersSchema.partial().optional(),
  display: UrlDisplayPatchSchema.optional(),
  rich_filters: RichFiltersSchema.nullable().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys of `value` whose value is not undefined; omits empty objects entirely. */
function compact<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function hasKeys(value: object | undefined): value is object {
  return value !== undefined && Object.keys(value).length > 0;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Base64url JSON of the state; an empty string when there is nothing to carry (drop the `q` param then). */
export function encodeUrlState(state: UrlState): string {
  const filters = state.filters ? compact(state.filters) : undefined;
  const display = state.display ? compact(state.display) : undefined;
  const payload: UrlState = {};
  if (hasKeys(filters)) payload.filters = filters;
  if (hasKeys(display)) payload.display = display;
  if (state.rich_filters !== undefined) payload.rich_filters = state.rich_filters;
  if (!hasKeys(payload)) return "";
  return toBase64Url(JSON.stringify(payload));
}

/** Parsed and validated state of a `q` param; `{}` for a missing, malformed or invalid value. */
export function decodeUrlState(q?: string | null): UrlState {
  if (!q) return {};
  const text = fromBase64Url(q);
  if (text === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(raw)) return {};
  const parsed = UrlStateSchema.safeParse(raw);
  if (!parsed.success) return {};
  const out: UrlState = {};
  if (parsed.data.filters) {
    const filters = compact(parsed.data.filters) as Filters;
    if (hasKeys(filters)) out.filters = filters;
  }
  if (parsed.data.display) {
    const { calendar, properties, ...top } = parsed.data.display;
    const display: Partial<Display> = compact(top);
    const calendarPatch = calendar ? compact(calendar) : undefined;
    const propertiesPatch = properties ? compact(properties) : undefined;
    // The nested patches stay sparse by contract (`Partial<Display>` cannot say so);
    // mergeDisplay merges them one level deep over the saved values.
    if (hasKeys(calendarPatch)) display.calendar = calendarPatch as Display["calendar"];
    if (hasKeys(propertiesPatch)) display.properties = propertiesPatch as Display["properties"];
    if (hasKeys(display)) out.display = display;
  }
  if (parsed.data.rich_filters !== undefined) out.rich_filters = parsed.data.rich_filters;
  return out;
}

/**
 * Patches over `defaults`, left to right; `calendar` and `properties` merge
 * one level deep so a patch can switch one property without resending the
 * rest. The result is a complete, schema-valid Display.
 */
export function mergeDisplay(defaults: Display, ...patches: (Partial<Display> | undefined)[]): Display {
  let merged: Display = { ...defaults, calendar: { ...defaults.calendar }, properties: { ...defaults.properties } };
  for (const patch of patches) {
    if (!patch) continue;
    const { calendar, properties, ...top } = compact(patch);
    merged = {
      ...merged,
      ...top,
      calendar: { ...merged.calendar, ...(calendar ? compact(calendar) : {}) },
      properties: { ...merged.properties, ...(properties ? compact(properties) : {}) },
    };
  }
  return DisplaySchema.parse(merged);
}

/** Filters patches over `defaults`; a key present in a later patch replaces the earlier value. */
export function mergeFilters(defaults: Filters, ...patches: (Filters | undefined)[]): Filters {
  let merged: Filters = { ...defaults };
  for (const patch of patches) {
    if (patch) merged = { ...merged, ...compact(patch) };
  }
  return merged;
}
