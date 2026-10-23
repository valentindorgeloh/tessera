"use client";

/**
 * Suggestion popovers of the description editor (docs/contracts/editor.md,
 * "Suggestion sources" and "Renderer"): `#` work items (GET /api/search),
 * `@` actors from the project bundle, `/` block commands and `[[` pages
 * (decision 10). One React list component is mounted through Tiptap's
 * `ReactRenderer` and positioned by the Suggestion plugin's `mount()`.
 */
import { useEffect, useId, useImperativeHandle, useState, type Ref } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { Editor, Range } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { exitSuggestion, type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { Icon, type IconProps } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { SearchHit } from "@/lib/tessera/types";
import {
  ACTOR_SUGGEST_KEY,
  BLOCK_SUGGEST_KEY,
  PAGE_SUGGEST_KEY,
  readSuggestionContext,
  WORK_ITEM_SUGGEST_KEY,
  type EditorSuggestions,
  type MentionTrigger,
  type SuggestionRow,
  type SuggestionTrigger,
} from "./extensions";
import {
  CheckIcon,
  CodeBlockIcon,
  DividerIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  QuoteIcon,
  TableIcon,
  TextH1Icon,
  TextH2Icon,
  TextH3Icon,
} from "@/themes/catppuccin/icons";
import { entityHref } from "./links";

const MAX_ROWS = 8;

/** One 16px glyph per `/` block command, in a 20px box (editor.css `tessera-editor-option-icon`). */
export const BLOCK_ICONS: Readonly<Record<string, IconProps["icon"]>> = {
  "heading-1": TextH1Icon,
  "heading-2": TextH2Icon,
  "heading-3": TextH3Icon,
  "bullet-list": ListBulletsIcon,
  "ordered-list": ListNumbersIcon,
  "task-list": CheckIcon,
  table: TableIcon,
  "code-block": CodeBlockIcon,
  quote: QuoteIcon,
  divider: DividerIcon,
};

type PopoverHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

type PopoverProps = {
  items: SuggestionRow[];
  loading: boolean;
  emptyText: string;
  /** Accessible name of the listbox ("Work items", "People", …). */
  listLabel: string;
  /** The editor's contenteditable: carries aria-controls and aria-activedescendant while the list shows. */
  editorDom: HTMLElement | null;
  onSelect: (row: SuggestionRow) => void;
  ref?: Ref<PopoverHandle>;
};

/** Id of the option at `index` in the listbox `listId`. */
export function suggestionOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/** ARIA the editor carries while a suggestion list is open: the list it controls and its active option. */
export function suggestionAria(listId: string, count: number, active: number): Record<string, string | null> {
  return {
    "aria-autocomplete": "list",
    "aria-controls": count > 0 ? listId : null,
    "aria-activedescendant": count > 0 ? suggestionOptionId(listId, active) : null,
  };
}

function applyAria(dom: HTMLElement, attrs: Record<string, string | null>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) dom.removeAttribute(name);
    else dom.setAttribute(name, value);
  }
}

/**
 * The list under the caret: Up/Down move, Enter picks, clicks pick. A listbox
 * of options (`aria-selected` on the active one); the focus stays in the
 * editor, which points at the active option through aria-activedescendant.
 */
function SuggestionPopover({ items, loading, emptyText, listLabel, editorDom, onSelect, ref }: PopoverProps) {
  const listId = useId();
  const [index, setIndex] = useState(0);
  // A new result set starts at the top (state-from-props pattern, no effect).
  const [seen, setSeen] = useState(items);
  if (seen !== items) {
    setSeen(items);
    setIndex(0);
  }
  const active = items.length === 0 ? 0 : Math.min(index, items.length - 1);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (event) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowUp") {
          setIndex((active + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setIndex((active + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          onSelect(items[active]);
          return true;
        }
        return false;
      },
    }),
    [active, items, onSelect],
  );

  // The editor (where the focus stays) announces the list and its active option; the attributes go when the list closes.
  useEffect(() => {
    if (editorDom === null) return;
    applyAria(editorDom, suggestionAria(listId, items.length, active));
    if (items.length > 0) document.getElementById(suggestionOptionId(listId, active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, editorDom, items.length, listId]);
  useEffect(() => {
    if (editorDom === null) return;
    return () => applyAria(editorDom, { "aria-autocomplete": null, "aria-controls": null, "aria-activedescendant": null });
  }, [editorDom]);

  return (
    <VStack className="tessera-editor-popover" gap={0} padding={1}>
      {items.length === 0 ? (
        <Text type="supporting" color="secondary" display="block" className="tessera-editor-popover-empty" role="status">
          {loading ? "Searching…" : emptyText}
        </Text>
      ) : (
        <VStack gap={0} role="listbox" id={listId} aria-label={listLabel}>
          {items.map((row, i) => (
            <HStack
              key={row.id}
              id={suggestionOptionId(listId, i)}
              role="option"
              aria-selected={i === active}
              gap={2}
              vAlign="center"
              className={i === active ? "tessera-editor-option tessera-editor-option--active" : "tessera-editor-option"}
              // Keep the caret in the editor: the pick runs on click.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onSelect(row)}
              // HStack takes no `title`; the hint is the row's native tooltip.
              ref={(el: HTMLElement | null) => {
                if (el !== null && row.hint !== undefined) el.title = row.hint;
              }}
            >
              {row.run !== undefined && BLOCK_ICONS[row.id] !== undefined ? (
                <HStack hAlign="center" vAlign="center" className="tessera-editor-option-icon">
                  <Icon icon={BLOCK_ICONS[row.id]} size="sm" color="secondary" />
                </HStack>
              ) : null}
              {row.token ? <Token label={row.token} size="sm" /> : null}
              <VStack gap={0} className="tessera-editor-option-text">
                <Text type="body" maxLines={1} hasTruncateTooltip={false}>
                  {row.label}
                </Text>
                {row.description ? (
                  <Text type="supporting" color="secondary" maxLines={1} hasTruncateTooltip={false}>
                    {row.description}
                  </Text>
                ) : null}
              </VStack>
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

/** Suggestion `render()` hooks around one `ReactRenderer`; `toSelected` maps a row to what the trigger's `command` expects. */
function createRenderer<TSelected>(
  emptyText: string,
  listLabel: string,
  pluginKey: typeof ACTOR_SUGGEST_KEY,
  toSelected: (row: SuggestionRow) => TSelected,
): NonNullable<SuggestionOptions<SuggestionRow, TSelected>["render"]> {
  return () => {
    let component: ReactRenderer<PopoverHandle, PopoverProps> | null = null;
    let unmount: (() => void) | null = null;
    const toProps = (props: SuggestionProps<SuggestionRow, TSelected>): PopoverProps => ({
      items: props.items,
      loading: props.loading,
      emptyText,
      listLabel,
      editorDom: props.editor.view.dom,
      onSelect: (row) => props.command(toSelected(row)),
    });
    return {
      onStart: (props) => {
        component = new ReactRenderer<PopoverHandle, PopoverProps>(SuggestionPopover, { editor: props.editor, props: toProps(props) });
        unmount = props.mount(component.element);
      },
      onUpdate: (props) => {
        component?.updateProps(toProps(props));
      },
      onKeyDown: ({ event, view }) => {
        if (event.key === "Escape") {
          exitSuggestion(view, pluginKey);
          return true;
        }
        return component?.ref?.onKeyDown(event) ?? false;
      },
      onExit: () => {
        unmount?.();
        unmount = null;
        component?.destroy();
        component = null;
      },
    };
  };
}

/** No triggers inside code: a `#` in a code block is code. */
function outsideCode({ state, range }: { state: EditorState; range: Range }): boolean {
  return !state.doc.resolve(range.from).parent.type.spec.code;
}

/** `@` candidates: actors whose name starts with the query (case-insensitive), at most eight. */
export function actorRows(actors: readonly { id: string; name: string }[], query: string): SuggestionRow[] {
  const needle = query.trim().toLowerCase();
  return actors
    .filter((actor) => actor.name.toLowerCase().startsWith(needle))
    .slice(0, MAX_ROWS)
    .map((actor) => ({ id: actor.id, label: actor.name }));
}

async function searchWorkItems(query: string, projectId: string | null, signal: AbortSignal): Promise<SuggestionRow[]> {
  const params = new URLSearchParams({ q: query, types: "work_item", limit: String(MAX_ROWS) });
  if (projectId) params.set("scope", projectId);
  const response = await fetch(`/api/search?${params.toString()}`, { signal });
  if (!response.ok) return [];
  const body = (await response.json()) as { hits?: SearchHit[] };
  return (body.hits ?? []).map((hit) => ({ id: hit.id, label: hit.title, token: hit.key, description: hit.subtitle }));
}

const rowOf = (hit: SearchHit): SuggestionRow => ({ id: hit.id, label: hit.title, description: hit.subtitle });

async function pageHits(params: Record<string, string>, signal: AbortSignal): Promise<SearchHit[]> {
  try {
    const response = await fetch(`/api/search?${new URLSearchParams(params).toString()}`, { signal });
    if (!response.ok) return [];
    return ((await response.json()) as { hits?: SearchHit[] }).hits ?? [];
  } catch (error) {
    // An aborted request (the next keystroke) is the suggestion plugin's business; any other failure shows no rows.
    if (signal.aborted) throw error;
    return [];
  }
}

/**
 * `[[` candidates (decision 10). In a project: that project's pages, then the
 * wiki pages (a scoped search leaves wiki pages out, so they come from a second,
 * unscoped request filtered to `project_id === null`). In the wiki: every page.
 * ASSUMPTION: a wiki page may link a project page, so the wiki search is unscoped.
 */
async function searchPages(
  query: string,
  projectId: string | null,
  pageId: string | null,
  signal: AbortSignal,
): Promise<SuggestionRow[]> {
  // The page being edited is dropped from the hits, so ask for one extra row to keep eight (decision 10).
  // ASSUMPTION: the wide `limit=20` wiki request already has slack for the filters and stays as it is.
  const limit = String(pageId === null ? MAX_ROWS : MAX_ROWS + 1);
  if (projectId === null) {
    const hits = await pageHits({ q: query, types: "page", limit }, signal);
    return hits.filter((hit) => hit.id !== pageId).slice(0, MAX_ROWS).map(rowOf);
  }
  const [inProject, everywhere] = await Promise.all([
    pageHits({ q: query, types: "page", limit, scope: projectId }, signal),
    pageHits({ q: query, types: "page", limit: "20" }, signal),
  ]);
  const wiki = everywhere.filter((hit) => hit.project_id === null);
  const seen = new Set<string>();
  const rows: SuggestionRow[] = [];
  for (const hit of [...inProject, ...wiki]) {
    if (hit.id === pageId || seen.has(hit.id)) continue;
    seen.add(hit.id);
    rows.push(rowOf(hit));
  }
  return rows.slice(0, MAX_ROWS);
}

/** A `[[` pick inserts the page name as text with a `page:` link mark, which serialises to `[Name](page:<id>)` and is recorded as a back-link on a page-body save. */
function insertPageLink(editor: Editor, range: Range, props: MentionNodeAttrs): void {
  if (!props.id) return;
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: "text", text: props.label || props.id, marks: [{ type: "link", attrs: { href: entityHref({ scheme: "page", ref: props.id }) } }] },
      { type: "text", text: " " },
    ])
    .run();
}

/** A `#` pick inserts the key as text with an entity link mark, which serialises to `[WEB-12](work:WEB-12)`. */
function insertWorkItemLink(editor: Editor, range: Range, row: SuggestionRow): void {
  const key = row.token ?? row.label;
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: "text", text: key, marks: [{ type: "link", attrs: { href: entityHref({ scheme: "work", ref: key }) } }] },
      { type: "text", text: " " },
    ])
    .run();
}

/** An `@` pick inserts `[@Name](actor:<id>)` the same way `#` inserts a work link. */
function insertActorLink(editor: Editor, range: Range, row: SuggestionRow): void {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: "text", text: `@${row.label}`, marks: [{ type: "link", attrs: { href: entityHref({ scheme: "actor", ref: row.id }) } }] },
      { type: "text", text: " " },
    ])
    .run();
}

const BLOCKS: readonly SuggestionRow[] = [
  { id: "heading-1", label: "Heading 1", run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "heading-2", label: "Heading 2", run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "heading-3", label: "Heading 3", run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "bullet-list", label: "Bullet list", run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: "ordered-list", label: "Numbered list", run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: "task-list", label: "Task list", run: (editor) => editor.chain().focus().toggleTaskList().run() },
  {
    id: "table",
    label: "Table",
    // A hint (the row's tooltip), not a description line: every block row keeps one height.
    hint: "3 by 3 with a header row",
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: "code-block", label: "Code block", run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: "quote", label: "Quote", run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: "divider", label: "Divider", run: (editor) => editor.chain().focus().setHorizontalRule().run() },
];

/** `/` candidates: every block command whose label contains the query (case-insensitive); the list is short enough to show whole. */
export function blockRows(query: string): SuggestionRow[] {
  const needle = query.trim().toLowerCase();
  return BLOCKS.filter((block) => block.label.toLowerCase().includes(needle));
}

const toMention = (row: SuggestionRow): MentionNodeAttrs => ({ id: row.id, label: row.label });
const identity = (row: SuggestionRow): SuggestionRow => row;

/**
 * The four trigger configs for `editorExtensions({ mentions })`. Static: the
 * actors and the `#` scope are read at query time from the editor's
 * suggestion context, which the host keeps current with `setSuggestionContext`.
 */
export function buildEditorSuggestions(): EditorSuggestions {
  const at: SuggestionTrigger = {
    char: "@",
    pluginKey: ACTOR_SUGGEST_KEY,
    allow: outsideCode,
    items: ({ query, editor }) => actorRows(readSuggestionContext(editor).actors, query),
    command: ({ editor, range, props }) => insertActorLink(editor, range, props),
    render: createRenderer("No one matches", "People", ACTOR_SUGGEST_KEY, identity),
  };
  const page: MentionTrigger = {
    char: "[[",
    pluginKey: PAGE_SUGGEST_KEY,
    debounce: 150,
    minQueryLength: 1,
    allow: outsideCode,
    items: ({ query, editor, signal }) => {
      const context = readSuggestionContext(editor);
      return searchPages(query, context.projectId, context.pageId ?? null, signal);
    },
    command: ({ editor, range, props }) => insertPageLink(editor, range, props),
    render: createRenderer("No pages match", "Pages", PAGE_SUGGEST_KEY, toMention),
  };
  const workItem: SuggestionTrigger = {
    char: "#",
    pluginKey: WORK_ITEM_SUGGEST_KEY,
    debounce: 150,
    minQueryLength: 1,
    allow: outsideCode,
    items: ({ query, editor, signal }) => searchWorkItems(query, readSuggestionContext(editor).projectId, signal),
    command: ({ editor, range, props }) => insertWorkItemLink(editor, range, props),
    render: createRenderer("No work items match", "Work items", WORK_ITEM_SUGGEST_KEY, identity),
  };
  const slash: SuggestionTrigger = {
    char: "/",
    pluginKey: BLOCK_SUGGEST_KEY,
    allow: outsideCode,
    items: ({ query }) => blockRows(query),
    command: ({ editor, range, props }) => {
      editor.chain().focus().deleteRange(range).run();
      props.run?.(editor);
    },
    render: createRenderer("No block matches", "Blocks", BLOCK_SUGGEST_KEY, identity),
  };
  return { at, page, workItem, slash };
}

/** True while any suggestion popover is open; Escape then closes it instead of blurring the editor. */
export function isSuggestionActive(state: EditorState): boolean {
  return [ACTOR_SUGGEST_KEY, PAGE_SUGGEST_KEY, WORK_ITEM_SUGGEST_KEY, BLOCK_SUGGEST_KEY].some((key) => key.getState(state)?.active === true);
}
