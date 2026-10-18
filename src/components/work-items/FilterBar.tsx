"use client";

/**
 * Filter bar (docs/contracts/ui.md "Work items screen"): a PowerSearch whose
 * tokens map one-to-one onto the engine's `Filters` keys. Every change is
 * written to the URL as the `q` param through `encodeUrlState`; the page
 * re-reads the list from that state, so the bar holds no filter state itself.
 * Filter keys the bar does not manage (parent, created_at, ...) pass through
 * untouched so a link built elsewhere keeps working. A removed token or
 * "Clear" writes an explicit empty value for keys the saved view settings
 * still carry (./filter-state.ts), so the saved filter cannot come back.
 */
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Token } from "@astryxdesign/core/Token";
import {
  PowerSearch,
  type DateTimeRangePart,
  type EnumItem,
  type PowerSearchConfig,
  type PowerSearchField,
  type PowerSearchFilter,
} from "@astryxdesign/core/PowerSearch";
import { HStack } from "@astryxdesign/core/Stack";
import { RichFilterDialog, richFilterChip } from "@/components/filters/RichFilterDialog";
import { withSearchParam } from "@/components/detail/peek-url";
import type { DateFilter, Filters, Priority, RichFilters, StateGroup } from "@/lib/tessera/types";
import { DATE_FIELDS, LIST_FIELDS, isDateField, isListField, withExplicitClears, type DateField, type ListField } from "./filter-state";
import { useProject } from "./project-provider";
import { PRIORITY_OPTIONS, isPriority, stateGroupLabel } from "./properties";
import { AdvancedFilterIcon } from "@/themes/catppuccin/icons";
import type { UrlState } from "./types";
import { encodeUrlState } from "./url-state";

export type FilterBarProps = {
  /** Current effective filters (defaults, saved settings and URL merged). */
  filters: Filters;
  /** Decoded `q` param; the bar rewrites its `filters` half. */
  urlState: UrlState;
  resultCount?: number;
  /** Workspace and profile lists can filter by project. Names of per-project fields gain the project identifier. */
  showProject?: boolean;
  /** Effective rich tree (URL, or a view's saved tree when the URL does not override it). */
  richFilters?: RichFilters | null;
};

const RELATIVE_WINDOWS = ["today", "1w", "2w", "1m"] as const;
type RelativeWindow = (typeof RELATIVE_WINDOWS)[number];
const STATE_GROUPS: readonly StateGroup[] = ["backlog", "unstarted", "started", "completed", "cancelled", "triage"];

const RELATIVE_LABELS: Record<RelativeWindow, string> = {
  today: "Today",
  "1w": "Within a week",
  "2w": "Within two weeks",
  "1m": "Within a month",
};

function isRelativeWindow(value: string): value is RelativeWindow {
  return (RELATIVE_WINDOWS as readonly string[]).includes(value);
}
function isStateGroup(value: string): value is StateGroup {
  return (STATE_GROUPS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Dates: the engine stores YYYY-MM-DD, PowerSearch speaks unix seconds.
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local noon keeps the calendar day stable across time zones. */
function isoToUnix(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day, 12).getTime() / 1000);
}

function unixToIso(unixSeconds: number): string {
  return toIsoDate(new Date(unixSeconds * 1000));
}

type RelativeUnit = Extract<DateTimeRangePart, { type: "RELATIVE" }>["unit"];
const UNIT_DAYS: Record<RelativeUnit, number> = {
  second: 0,
  minute: 0,
  hour: 0,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

function partToIso(part: DateTimeRangePart): string {
  switch (part.type) {
    case "NOW":
      return toIsoDate(new Date());
    case "ABSOLUTE":
      return unixToIso(part.unixSeconds);
    case "RELATIVE": {
      const date = new Date();
      date.setDate(date.getDate() - part.backValue * UNIT_DAYS[part.unit]);
      return toIsoDate(date);
    }
  }
}

function dateFilterToToken(field: DateField, filter: DateFilter): PowerSearchFilter | null {
  if (filter.relative) return { field, operator: "within", value: { type: "enum", value: filter.relative } };
  if (filter.op === "before" && filter.to) return { field, operator: "before", value: { type: "date_absolute", unixSeconds: isoToUnix(filter.to) } };
  if (filter.op === "after" && filter.from) return { field, operator: "after", value: { type: "date_absolute", unixSeconds: isoToUnix(filter.from) } };
  if (filter.op === "between" && filter.from && filter.to) {
    return {
      field,
      operator: "between",
      value: {
        type: "date_range",
        value: { start: { type: "ABSOLUTE", unixSeconds: isoToUnix(filter.from) }, end: { type: "ABSOLUTE", unixSeconds: isoToUnix(filter.to) } },
      },
    };
  }
  return null;
}

function tokenToDateFilter(token: PowerSearchFilter): DateFilter | null {
  const { value } = token;
  switch (token.operator) {
    case "within":
      return value.type === "enum" && isRelativeWindow(value.value) ? { op: "between", relative: value.value } : null;
    case "before":
      return value.type === "date_absolute" ? { op: "before", to: unixToIso(value.unixSeconds) } : null;
    case "after":
      return value.type === "date_absolute" ? { op: "after", from: unixToIso(value.unixSeconds) } : null;
    case "between": {
      if (value.type !== "date_range") return null;
      const a = partToIso(value.value.start);
      const b = partToIso(value.value.end);
      return a <= b ? { op: "between", from: a, to: b } : { op: "between", from: b, to: a };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Filters <-> tokens
// ---------------------------------------------------------------------------

function toTokens(filters: Filters): PowerSearchFilter[] {
  const tokens: PowerSearchFilter[] = [];
  if (filters.search) tokens.push({ field: "search", operator: "contains", value: { type: "string", value: filters.search } });
  for (const field of LIST_FIELDS) {
    const values = filters[field];
    if (values && values.length > 0) tokens.push({ field, operator: "is", value: { type: "enum_list", value: values } });
  }
  for (const field of DATE_FIELDS) {
    const filter = filters[field];
    const token = filter ? dateFilterToToken(field, filter) : null;
    if (token) tokens.push(token);
  }
  return tokens;
}

function fromTokens(current: Filters, tokens: ReadonlyArray<PowerSearchFilter>): Filters {
  const next: Filters = {};
  // Keys the bar does not manage, and date conditions it cannot show, survive a change untouched.
  for (const [key, value] of Object.entries(current)) {
    if (value === undefined || key === "search" || isListField(key)) continue;
    if (isDateField(key)) {
      const filter = current[key];
      if (filter && dateFilterToToken(key, filter) === null) next[key] = filter;
      continue;
    }
    Object.assign(next, { [key]: value });
  }
  for (const token of tokens) {
    const { field, value } = token;
    if (field === "search" && value.type === "string" && value.value.trim()) {
      next.search = value.value.trim();
    } else if (isListField(field) && value.type === "enum_list" && value.value.length > 0) {
      const merged = [...(next[field] ?? []), ...value.value];
      const unique = Array.from(new Set(merged));
      if (field === "state_group") next.state_group = unique.filter(isStateGroup);
      else if (field === "priority") next.priority = unique.filter((v): v is Priority => isPriority(v));
      else next[field] = unique;
    } else if (isDateField(field)) {
      const filter = tokenToDateFilter(token);
      if (filter) next[field] = filter;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function listField(key: ListField, label: string, values: EnumItem[]): PowerSearchField {
  return { key, label, operators: [{ key: "is", label: "is any of", value: { type: "enum_list", values } }], defaultOperator: "is" };
}

function dateField(key: DateField, label: string): PowerSearchField {
  return {
    key,
    label,
    defaultOperator: "within",
    operators: [
      { key: "within", label: "is", value: { type: "enum", values: RELATIVE_WINDOWS.map((value) => ({ value, label: RELATIVE_LABELS[value] })) } },
      { key: "before", label: "is before", value: { type: "date_absolute", isDateOnly: true } },
      { key: "after", label: "is after", value: { type: "date_absolute", isDateOnly: true } },
      { key: "between", label: "is between", value: { type: "date_range" } },
    ],
  };
}

export function FilterBar({ filters, urlState, resultCount, showProject = false, richFilters }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { bundle } = useProject();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const tree = richFilters === undefined ? (urlState.rich_filters ?? null) : richFilters;
  const chip = richFilterChip(tree);

  const writeRich = (next: RichFilters | null) => {
    const state: UrlState = {};
    if (urlState.display) state.display = urlState.display;
    if (urlState.filters) state.filters = urlState.filters;
    state.rich_filters = next;
    router.replace(withSearchParam(pathname, searchParams, "q", encodeUrlState(state) || null), { scroll: false });
  };

  const config = useMemo<PowerSearchConfig>(() => {
    const identifier = new Map(bundle.projects.map((project) => [project.id, project.identifier]));
    const named = (name: string, projectId: string) => {
      if (!showProject) return name;
      const code = identifier.get(projectId);
      return code ? `${name} · ${code}` : name;
    };
    const fields: PowerSearchField[] = [
      { key: "search", label: "Search", operators: [{ key: "contains", label: "contains", value: { type: "string" } }], defaultOperator: "contains" },
    ];
    if (showProject) fields.push(listField("project", "Project", bundle.projects.map((project) => ({ value: project.id, label: project.name, description: project.identifier }))));
    fields.push(
      listField("state", "State", bundle.states.map((state) => ({ value: state.id, label: named(state.name, state.project_id) }))),
      listField("state_group", "State group", STATE_GROUPS.map((group) => ({ value: group, label: stateGroupLabel(group) }))),
      listField("priority", "Priority", PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))),
      listField("labels", "Labels", bundle.labels.map((label) => ({ value: label.id, label: named(label.name, label.project_id) }))),
      listField("assignees", "Assignees", bundle.actors.filter((actor) => !actor.deleted_at).map((actor) => ({ value: actor.id, label: actor.name }))),
    );
    if (bundle.project.cycles_enabled) fields.push(listField("cycle", "Cycle", bundle.cycles.map((cycle) => ({ value: cycle.id, label: named(cycle.name, cycle.project_id) }))));
    if (bundle.project.modules_enabled) fields.push(listField("module", "Module", bundle.modules.map((module) => ({ value: module.id, label: named(module.name, module.project_id) }))));
    fields.push(dateField("target_date", "Target date"), dateField("start_date", "Start date"));
    return { name: "work-items", fields, contentSearchFieldKey: "search" };
  }, [bundle, showProject]);

  const tokens = useMemo(() => toTokens(filters), [filters]);

  const write = (next: Filters) => {
    const state: UrlState = {};
    if (urlState.display) state.display = urlState.display;
    if (urlState.rich_filters !== undefined) state.rich_filters = urlState.rich_filters;
    if (Object.keys(next).length > 0) state.filters = next;
    // Only `q` changes: the other params (an open `peek`) stay.
    router.replace(withSearchParam(pathname, searchParams, "q", encodeUrlState(state) || null), { scroll: false });
  };

  return (
    <HStack gap={2} vAlign="center" className="tessera-wi-filter">
      <PowerSearch
        className="tessera-wi-search"
        config={config}
        filters={tokens}
        onChange={(next) => write(withExplicitClears(filters, fromTokens(filters, next)))}
        label="Filter work items"
        isLabelHidden
        placeholder="Filter work items"
        size="sm"
        resultCount={resultCount}
      />
      {tokens.length > 0 ? <Button variant="ghost" size="sm" label="Clear" onClick={() => write(withExplicitClears(filters, {}))} /> : null}
      <Button variant="ghost" size="sm" label="Advanced" icon={<AdvancedFilterIcon />} onClick={() => setAdvancedOpen(true)} />
      {chip ? <Token label={chip} onRemove={() => writeRich(null)} /> : null}
      <RichFilterDialog isOpen={advancedOpen} onOpenChange={setAdvancedOpen} tree={tree} onApply={writeRich} />
    </HStack>
  );
}
