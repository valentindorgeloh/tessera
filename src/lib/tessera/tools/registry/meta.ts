import { listChanges, ListChangesInput } from "../../changes";
import { getCounts, GetCountsInput } from "../../counts";
import { searchAll, SearchAllInput } from "../../search";
import { defineTool } from "../define";
import { describeFilters } from "../describe-filters";
import { EmptyInput } from "./shared";

// ---------------------------------------------------------------------------
// Meta (P1)
// ---------------------------------------------------------------------------

export const metaTools = [
  defineTool({
    name: "get_counts",
    title: "Get counts",
    description:
      "Counts the work items of a scope (workspace, project, cycle, module, saved view or an actor's profile): total, by state group, state, priority, assignee and label, overdue and due this week, plus points when estimates are enabled.",
    input: GetCountsInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { scope }) => getCounts(ctx, scope),
  }),
  defineTool({
    name: "search_all",
    title: "Search",
    description:
      "Searches projects, work items, cycles, modules, views and pages by free text or a work item key such as WEB-12; a key hit ranks first, then exact names, then full-text relevance. Narrow with scope.project_id or types; archived entities are left out unless include_archived is true. Returns hits ordered by score.",
    input: SearchAllInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { q, ...options }) => searchAll(ctx, q, options),
  }),
  defineTool({
    name: "list_changes",
    title: "List changes",
    description:
      "Polling feed for the UI and agents: activity rows with seq greater than since_seq, oldest first, without values; exclude_actors drops the caller's own changes. The returned cursor is the next since_seq.",
    input: ListChangesInput,
    mutates: false,
    phase: "P1",
    run: (ctx, { since_seq, exclude_actors, limit }) => listChanges(ctx, since_seq, { excludeActors: exclude_actors, limit }),
  }),
  defineTool({
    name: "describe_filters",
    title: "Describe filters",
    description:
      "Returns the enums, the type of every Filters field (ids with the entity kind, enum, date, text, boolean), the allowed values of every Display key, the default display, the paging keys of list_work_items (per_group_limit, group_value, sub_group_value, group_limits, calendar_window) and worked examples, so an agent can build list_work_items and view inputs without reading the schema.",
    input: EmptyInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: () => describeFilters(),
  }),
];
