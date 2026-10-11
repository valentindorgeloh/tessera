# Editor contract (P2b, lane D1)

Owner: lane D (docs/contracts/OWNERS.md). Referenced from docs/contracts/ui.md
"P2b: detail, editor, Power K". Every import path and option below was checked
against the installed packages on 2026-10-11; the declaration file read is given
in brackets. Paths are relative to `node_modules/` unless they start with `src/`.

## Packages

Installed, all `3.31.4` (package.json): `@tiptap/core`, `@tiptap/pm`,
`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/suggestion`,
`@tiptap/extension-mention`, `@tiptap/extension-table`, `@tiptap/extensions`,
`@tiptap/extension-code-block-lowlight`, `@tiptap/extension-drag-handle`,
`@tiptap/extension-drag-handle-react`; `lowlight 3.3.0` (MIT).

Missing, to be installed P0-style (exact pins, licence gate re-run) before D1 starts:

- `@tiptap/extension-link@3.31.4` and `@tiptap/extension-list@3.31.4` exist only
  as transitive dependencies of `@tiptap/starter-kit` today. The imports below
  must not rely on hoisting: `npm i -E @tiptap/extension-link@3.31.4 @tiptap/extension-list@3.31.4`.
- `jsdom@30.1.2` as a devDependency (MIT; engines `^22.22.2 || ^24.15.0 || >=26.0.0`,
  the repo's Node 22.23.3 satisfies it; its dependency tree is MIT/ISC/BSD, including
  `@asamuzakjp/css-color` and `@csstools/css-syntax-patches-for-csstree`):
  `npm i -D -E jsdom@30.1.2`. Needed because `@tiptap/markdown` parses inline HTML
  with `window.DOMParser` (`@tiptap/markdown/dist/index.js` around line 927, falling
  back to literal text without a DOM) and `@tiptap/core`'s `Editor` builds a
  ProseMirror view in `document`. `happy-dom 20.14.6` would also work but pulls `ws`;
  jsdom is the one named here.
- docs/PLAN.md §11 lists `@tiptap/extension-task-list`, `@tiptap/extension-placeholder`,
  `@tiptap/extension-link` and `@tiptap/extension-bubble-menu` as installs. In 3.31.4
  TaskList/TaskItem live in `@tiptap/extension-list`, Placeholder in
  `@tiptap/extensions`, the React `BubbleMenu` in `@tiptap/react/menus` (its plugin
  package `@tiptap/extension-bubble-menu` is already a transitive dependency and
  is not imported directly). Do not install the old names.

## Files (all lane D1)

- `src/components/editor/MarkdownEditor.tsx` — `"use client"`; the component.
- `src/components/editor/extensions.ts` — `editorExtensions(options)`; no React
  import, so the Vitest corpus loads the same list the component uses.
- `src/components/editor/mentions.tsx` — the suggestion renderer (`ReactRenderer`
  + a popover list) and the trigger configs for `#`, `@`, `[[` and `/`.
- `src/components/editor/links.ts` — pure entity-link helpers, tested.
- `src/components/editor/useDescriptionSave.ts` — `"use client"` hook: debounce,
  CAS, conflict state, pagehide beacon. Lane D2's `DescriptionEditor` composes
  it with `MarkdownEditor` and the Banner.
- `src/components/editor/index.ts` — re-exports.
- `src/components/styles/editor.css` + one `@import "../components/styles/editor.css";`
  line in `src/app/globals.css` (additive, same form as the P2a lines). Class
  prefix `tessera-editor-`, tokens only.
- `src/app/api/work-items/[workItemId]/description/route.ts` — the beacon target.
- `tests/editor/markdown-roundtrip.test.ts`, `tests/editor/links.test.ts`.

Import boundary: everything under `src/components/editor` is client code and may
import from `@/lib/tessera/types`, `@/lib/tessera/schemas` and
`@/lib/tessera/core/keys` only (eslint.config.mjs line 45, scripts/check-conventions.ts
`CLIENT_ALLOWED_TESSERA_IMPORTS`). Server Actions come from `@/app/actions/*`.

## MarkdownEditor interface

```ts
// src/components/editor/MarkdownEditor.tsx
import type { Ref } from "react";

export const ENTITY_LINK_SCHEMES = ["work", "page", "cycle", "module"] as const;
export type EntityLinkScheme = (typeof ENTITY_LINK_SCHEMES)[number];

export type MarkdownEditorHandle = {
  /** Current document as Markdown (editor.getMarkdown()). */
  getMarkdown(): string;
  /** Replaces the document without firing onChange; used by "Load theirs" and the source toggle. */
  setMarkdown(markdown: string): void;
  /** True while the editor holds edits that onChange has reported but no later setMarkdown/value accepted. */
  hasLocalEdits(): boolean;
  isFocused(): boolean;
  focus(): void;
  setMode(mode: "rich" | "source"): void;
};

export type MarkdownEditorProps = {
  /** Markdown the host currently holds (server value after every refresh). */
  value: string;
  /** Fires on every user-originated change that moved the document (transaction.docChanged), not debounced. */
  onChange: (markdown: string) => void;
  /** Blur, mod+s, Escape inside the editor: the host saves right away. */
  onFlush?: () => void;
  /** Called once after mount when parse→serialise changed the text; `serialised` is what a save would store. */
  onLossyParse?: (serialised: string) => void;
  readOnly?: boolean;
  /** Peek: no drag handle, tighter padding, no table controls. */
  compact?: boolean;
  placeholder?: string;
  /** Default ENTITY_LINK_SCHEMES. */
  linkSchemes?: readonly string[];
  /** `@` candidates (ProjectBundle.actors mapped to id + name). */
  mentionActors?: readonly { id: string; name: string }[];
  /** Scope of the `#` search (GET /api/search?scope=); null outside a project. */
  projectId?: string | null;
  /** Click on an entity link or chip; the host navigates (work → ?peek / page). */
  onOpenEntity?: (link: EntityLink) => void;
  ref?: Ref<MarkdownEditorHandle>;
};
```

```ts
// src/components/editor/links.ts (pure)
export type EntityLink = { scheme: EntityLinkScheme; ref: string };          // { scheme: "work", ref: "WEB-12" }
export function parseEntityHref(href: string): EntityLink | null;             // "work:WEB-12" → { work, WEB-12 }; "https://…" → null
export function entityHref(link: EntityLink): string;                         // → "work:WEB-12"
export function isAllowedEditorUri(url: string, schemes?: readonly string[]): boolean; // http(s)/mailto + the entity schemes
export function entityRoute(link: EntityLink): string | null;                 // work → `/browse/${ref}`, others null until P3/P6
```

External value rule (never remount): the editor is keyed by the work item id by
its host (`<MarkdownEditor key={item.id} …/>`); a new `value` prop is applied with
`editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false })`
(`@tiptap/core/dist/index.d.ts` `SetContentOptions` ~line 3812, `contentType`
augmentation in `@tiptap/markdown/dist/index.d.ts`) only when
`!hasLocalEdits() && !editor.isFocused` and the text differs from the last
accepted value. Otherwise the prop change is ignored; the host decides (Banner).

## useEditor call

```ts
const editor = useEditor(
  {
    immediatelyRender: false,             // UseEditorOptions, @tiptap/react/dist/index.d.ts: no SSR render → no hydration mismatch
    shouldRerenderOnTransaction: false,   // toolbar state through useEditorState()
    extensions: editorExtensions({ compact, placeholder, linkSchemes, mentions }),
    content: value,
    contentType: "markdown",              // @tiptap/markdown EditorOptions augmentation
    editable: !readOnly,
    editorProps: {
      attributes: { class: "tessera-editor-content" },
      handleClick: (view, pos, event) => openEntityOnClick(event),  // anchors with an entity scheme → onOpenEntity
      handleKeyDown: (view, event) => { /* mod+s → onFlush; Escape → editor.commands.blur() then onFlush */ },
    },
    onCreate: ({ editor }) => { const out = editor.getMarkdown(); if (normalise(out) !== normalise(value)) onLossyParse?.(out); },
    onUpdate: ({ editor, transaction }) => {
      if (!transaction.docChanged) return;
      const md = editor.getMarkdown();
      if (md === lastReported.current) return;
      lastReported.current = md;
      onChange(md);
    },
    onBlur: () => onFlush?.(),
  },
  [],                                     // never recreate; readOnly changes go through editor.setEditable (core ~line 4365)
);
```

`normalise` trims trailing newlines only. `useEditor(options, deps)` overloads:
`@tiptap/react/dist/index.d.ts`. `EditorContent` takes `{ editor }` (same file).

## Extensions (`src/components/editor/extensions.ts`)

```ts
import { StarterKit } from "@tiptap/starter-kit";                               // starter-kit/dist/index.d.ts line 136
import { Markdown } from "@tiptap/markdown";                                    // markdown/dist/index.d.ts line 428
import { Link } from "@tiptap/extension-link";                                  // extension-link/dist/index.d.ts line 158
import { TaskItem, TaskList } from "@tiptap/extension-list";                    // extension-list/dist/index.d.ts line 389
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"; // extension-table/dist/index.d.ts line 343
import { Placeholder } from "@tiptap/extensions";                               // extensions/dist/index.d.ts line 320
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";      // extension-code-block-lowlight/dist/index.d.ts line 15
import { common, createLowlight } from "lowlight";                              // lowlight/index.d.ts lines 4–5
import { Mention } from "@tiptap/extension-mention";                            // extension-mention/dist/index.d.ts line 93
import { Suggestion } from "@tiptap/suggestion";                                // suggestion/dist/index.d.ts line 418
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";                                   // @tiptap/pm/package.json exports "./state"
```

Configuration (verified option names):

- `StarterKit.configure({ link: false, codeBlock: false })` — the StarterKit
  bundles `link`, `codeBlock`, `undoRedo`, `trailingNode`, `listKeymap`,
  `underline` (`starter-kit/dist/index.d.ts`); Link and CodeBlock are replaced
  below, the rest stays (Dropcursor, Gapcursor, Bold/Italic/Strike/Code,
  Blockquote, HorizontalRule, HardBreak, Heading, Bullet/Ordered list, Paragraph, Text).
- `Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: [...linkSchemes], isAllowedUri: (url, ctx) => isAllowedEditorUri(url, ctx.protocols) || ctx.defaultValidate(url) })`
  — `protocols`, `isAllowedUri(url, { defaultValidate, protocols, defaultProtocol })`,
  `openOnClick`, `autolink`, `linkOnPaste` in `extension-link/dist/index.d.ts`.
  The entity schemes must be in `protocols`, otherwise `renderHTML` drops the href.
- `CodeBlockLowlight.configure({ lowlight: createLowlight(common) })`
  (`extension-code-block-lowlight/dist/index.d.ts`; `common` keeps the bundle small).
- `TaskList`, `TaskItem.configure({ nested: true })` (`extension-list/dist/index.d.ts`:
  TaskItem `{ nested, onReadOnlyChecked, taskListTypeName, a11y }`).
- `Table.configure({ resizable: false })`, `TableRow`, `TableHeader`, `TableCell`
  (`extension-table/dist/index.d.ts`; the package serialises tables itself via `renderTableToMarkdown`).
- `Placeholder.configure({ placeholder, showOnlyWhenEditable: true })`
  (`extensions/dist/index.d.ts`: `{ placeholder, emptyEditorClass, emptyNodeClass, showOnlyWhenEditable }`).
- `Markdown` (no options) — adds `editor.getMarkdown()`, `contentType: "markdown"`
  on `setContent`/`insertContent`/`EditorOptions`, and per-extension
  `parseMarkdown` / `renderMarkdown` / `markdownTokenizer` hooks
  (`@tiptap/core/dist/index.d.ts` `ExtensionConfig` ~lines 1115–1150). Unknown HTML
  stays as literal text; markdown-significant characters outside code are escaped.
- `Mention.configure({ renderText, renderHTML, deleteTriggerWithBackspace: true, suggestions: [atTrigger, pageTrigger] })`
  — multiple triggers go through the `suggestions` array (`extension-mention/dist/index.d.ts`
  line 77, each entry `Omit<SuggestionOptions, "editor">` with its own `char` and
  `pluginKey`). `MentionNodeAttrs = { id, label?, mentionSuggestionChar? }`.
  `Mention.extend({ renderMarkdown: ({ node }) => `@${node.attrs.label ?? node.attrs.id}` })`
  so an actor mention serialises as plain `@Name` and parses back as text
  (lossless as text; P7 may upgrade it to `[@Name](actor:<id>)`).
- `#` work items and `/` blocks are plain `Suggestion` plugins wrapped in
  `Extension.create({ name: "work-item-suggest", addProseMirrorPlugins() { return [Suggestion({ editor: this.editor, pluginKey: new PluginKey("suggest-work-item"), char: "#", … })]; } })`
  — a `#` pick inserts the key as text carrying a Link mark
  (`insertContent({ type: "text", text: "WEB-12", marks: [{ type: "link", attrs: { href: "work:WEB-12" } }] })`
  plus a trailing space), which serialises to `[WEB-12](work:WEB-12)` without any custom node.
  `SuggestionOptions`: `char`, `pluginKey`, `items({ query, editor, signal })`,
  `render()` hooks, `command({ editor, range, props })`, `allowedPrefixes`,
  `debounce`, `minQueryLength` (`suggestion/dist/index.d.ts`).
- `[[` is registered as a third trigger (`char: "[["`, `pluginKey: new PluginKey("suggest-page")`)
  whose `items` returns `[]` and whose popover says "Pages arrive in P6"; it exists
  so the keystroke is reserved and the P6 lane only fills `items`.

Suggestion sources:

- `#`: `fetch(`/api/search?q=${q}&types=work_item&limit=8${projectId ? `&scope=${projectId}` : ""}`, { signal })`
  → `{ hits: SearchHit[] }` (route contract in ui.md "Power K"); `debounce: 150`,
  `minQueryLength: 1`. Rendered rows: key as `Token`, title.
- `@`: `mentionActors` filtered by name prefix, max 8.
- `/`: static list — Heading 1/2/3, Bullet list, Numbered list, Task list, Table
  (3×3), Code block, Quote, Divider; the command deletes the typed range then
  runs the editor command.

Renderer (`mentions.tsx`): `ReactRenderer` from `@tiptap/react` (`react/dist/index.d.ts`)
mounted through the Suggestion `render()` hooks (`onStart`/`onUpdate`/`onKeyDown`/`onExit`;
`SuggestionProps.mount(element) => unmount` positions the popover). Up/Down/Enter/Escape
are handled in `onKeyDown`; the list is Astryx `List`/`ListItem` inside a
`Popover`-less absolutely positioned `div.tessera-editor-popover` (tokens only).

Bubble menu: `BubbleMenu` from `@tiptap/react/menus` (`react/dist/menus/index.d.ts`)
with `editor`, `shouldShow: ({ editor, from, to }) => from !== to && !editor.isActive("codeBlock")`,
`options={{ placement: "top" }}` (`extension-bubble-menu/dist/index.d.ts`): Bold,
Italic, Strike, Code, Link (inline URL input; `setLink({ href })` / `unsetLink()`).

Drag handle: `DragHandle` from `@tiptap/extension-drag-handle-react`
(`extension-drag-handle-react/dist/index.d.ts`: `{ editor, children, nested?, onNodeChange, className }`)
rendered when `!compact`, child icon `DragHandleIcon` (add `export const DragHandleIcon = duotoneIcon(DotsSixVertical);`
to `src/themes/paper/icons.tsx`, additive, named in the hand-off). Its peers
`@tiptap/extension-node-range`, `@tiptap/extension-collaboration`, `@tiptap/y-tiptap`
are already installed transitively.

Source toggle: `mode: "rich" | "source"` state inside `MarkdownEditor`; a toolbar
button "Source" (and `mod+shift+m`). Rich → source copies `getMarkdown()` into a
`<textarea className="tessera-editor-source">` (Astryx `TextArea` if
`npx astryx component TextArea` lists one, else the plain element); source → rich
runs `setContent(text, { contentType: "markdown" })` and reports `onChange`
when the text changed. Source edits report `onChange` on every input event.

## Save queue (`useDescriptionSave`)

```ts
export type DescriptionSaveStatus = "clean" | "dirty" | "saving" | "conflict" | "error";
export type DescriptionSaveState = {
  status: DescriptionSaveStatus;
  /** description_version of the text the editor currently builds on. */
  version: number;
  /** Set on CONFLICT from the action or the beacon route. */
  conflict: { current_version: number } | null;
  /** Server text that arrived while the editor had local edits or focus. */
  theirs: { version: number; text: string } | null;
  /** Serialised form reported by onLossyParse; cleared by "Edit anyway" or source editing. */
  lossy: string | null;
  error: string | null;
};

export function useDescriptionSave(input: {
  workItemId: string;
  /** Props from the host: refreshed by refresh() after writes and by ChangesPoller. */
  serverText: string;
  serverVersion: number;
  editor: RefObject<MarkdownEditorHandle | null>;
}): {
  state: DescriptionSaveState;
  onChange: (markdown: string) => void;   // marks dirty, (re)starts the 400 ms timer
  flush: () => Promise<void>;             // sends now (blur, mod+s, Escape, unmount, item switch)
  keepMine: () => Promise<void>;          // resend with expected_description_version = conflict.current_version
  loadTheirs: () => void;                 // editor.setMarkdown(theirs.text), version = theirs.version, clean
  editAnyway: () => void;                 // lossy → null, editor editable again
  viewSource: () => void;                 // editor.setMode("source"), lossy → null
};
```

Rules (docs/PLAN.md §7):

- Debounce 400 ms after the last `onChange`; a save sends
  `updateWorkItemDescriptionAction({ work_item_id, description_md, expected_description_version: state.version })`
  (`src/app/actions/work-items.ts` line 13; input `UpdateWorkItemDescriptionInput`,
  `src/lib/tessera/work-items.ts` line 1211). Only one request in flight; a change
  during a save marks dirty again and resends after it returns. Skip the send when
  the text equals the last saved text.
- `{ ok: true, data }` → `version = data.description_version`, status `clean`
  unless edits arrived meanwhile. `runTool` already calls `refresh()`
  (`src/app/actions/_run.ts`), so the host's `serverVersion` catches up; a
  `serverVersion === state.version` prop change is a no-op.
- `{ ok: false, code: "CONFLICT" }` → `conflict = { current_version: details.current_version }`,
  status `conflict`. The host shows the Banner (status `warning`, title "Changed
  elsewhere", description "Someone else saved this description while you were
  editing.") with `endContent` buttons "Keep mine" (`keepMine`) and "Load theirs"
  (`loadTheirs`). If `theirs` is still null when the user clicks "Load theirs",
  call `refreshAction()` (`src/app/actions/shell.ts`) and apply once
  `serverVersion` moves. Astryx `Banner` has no `actions` prop; use `endContent`
  (`@astryxdesign/core/dist/Banner/Banner.d.ts`).
- `serverVersion !== state.version` while clean and unfocused → silent accept
  (`editor.setMarkdown(serverText)`, `version = serverVersion`). While dirty or
  focused → `theirs = { version, text }` and the same Banner (title "Updated
  elsewhere") so the user chooses; `keepMine` in that case saves with
  `expected_description_version = theirs.version`.
- Other failures (`ARCHIVED`, `NOT_FOUND`, `INTERNAL`, `BUSY`) → status `error`,
  Toast with the message, text kept in the editor; the next edit retries.
- `onLossyParse` → `lossy = serialised`, `editor.setMode` untouched but the editor
  is made read-only (`readOnly` prop from the host) until "Edit anyway" or "View
  source". Banner status `info`, title "This description uses Markdown the editor
  would rewrite", `endContent`: "View source", "Edit anyway". Saves are blocked while
  `lossy !== null`.
- `pagehide` listener (and `visibilitychange` → `hidden`): when status is `dirty`
  or `saving` with newer text, send
  `navigator.sendBeacon(`/api/work-items/${workItemId}/description`, new Blob([JSON.stringify({ description_md, expected_description_version: state.version })], { type: "application/json" }))`.
  The Blob type makes the request `application/json`, so the route can call
  `request.json()`. Nothing waits for the answer.
- Unmount cleanup (peek closed, item switched, tab closed) calls `flush()`;
  the Server Action call outlives the component.

## Beacon route: `POST /api/work-items/[workItemId]/description`

File `src/app/api/work-items/[workItemId]/description/route.ts` (lane D1).
Body `{ description_md: string; expected_description_version: number }` read with
`await request.json()` (`next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
"Request Body", line 483). The handler:

```ts
import { type NextRequest } from "next/server";
import { createContext, fromSqliteError, getDb, getTool, isTrackerError, runToolWithContext, USER_ACTOR_ID, validateInput } from "@/lib/tessera/server";
// every name above is re-exported by src/lib/tessera/index.ts (core/context, core/errors, actors, tools/registry) through server.ts

export async function POST(request: NextRequest, { params }: { params: Promise<{ workItemId: string }> }): Promise<Response> {
  const { workItemId } = await params;
  const headers = { "Cache-Control": "no-store" };
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, code: "VALIDATION", message: "JSON body required" }, { status: 400, headers }); }
  try {
    const def = getTool("update_work_item_description");
    const data = validateInput(def.input, { work_item_id: workItemId, ...(body as object) });
    const { db, sqlite } = getDb();
    const ctx = createContext({ db, sqlite, actorId: USER_ACTOR_ID });
    const run = await runToolWithContext(ctx, def.name, data);
    return Response.json({ ok: true, description_version: run.data.description_version, cursor: run.cursor }, { headers });
  } catch (err) {
    const mapped = fromSqliteError(err);
    if (isTrackerError(mapped)) return Response.json({ ok: false, code: mapped.code, message: mapped.message, ...(mapped.code === "CONFLICT" ? { current_version: (mapped.details as { current_version: number }).current_version } : {}) }, { status: STATUS[mapped.code] ?? 400, headers });
    console.error("[tessera] description beacon failed", mapped);
    return Response.json({ ok: false, code: "INTERNAL", message: "Unexpected error" }, { status: 500, headers });
  }
}
```

Status map: `VALIDATION` 400, `NOT_FOUND` 404, `CONFLICT` 409 (`{ current_version }`),
`ARCHIVED` and `LOCKED` 423, `RULE` 422, `BUSY` 503, anything else 400. The handler
never calls `refresh()` — Next allows it in Server Actions only
(`next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` line 13); the
open page, if any, catches up through `ChangesPoller` on the next visit. Mirrors
`src/app/actions/_run.ts` rather than importing it (`runTool` refreshes).
`GET` is not implemented (405 by default).

## Vitest corpus: `tests/editor/markdown-roundtrip.test.ts`

- First line `// @vitest-environment jsdom` (Vitest honours the docblock per file:
  `node_modules/vitest/dist/chunks/index.DpLw24bj.js` line 6034); the global
  environment stays `node` (`vitest.config.mts`, better-sqlite3 tests). Also
  `tests/editor/links.test.ts` for `parseEntityHref` / `entityHref` /
  `isAllowedEditorUri` / `entityRoute` (environment `node`).
- Headless editor: `new Editor({ element: null, extensions: editorExtensions({ compact: true, mentions: null }), content: md, contentType: "markdown" })`
  (`@tiptap/core/dist/index.d.ts` `EditorOptions.element: Element | { mount } | fn | null`
  ~line 1650). If `getMarkdown()` needs a mounted view on this version, use
  `element: document.createElement("div")` instead; call `editor.destroy()` after each case.
- Corpus (docs/PLAN.md §12): ATX headings 1–3; paragraphs with bold/italic/strike/
  inline code and escaped `*` `_` `#`; bullet and ordered lists nested three deep
  (2-space indent); task lists `- [ ]` / `- [x]` nested in bullets; a 3-column GFM
  table with a pipe escaped as `\|`; fenced code with a language and with none,
  containing `#` and `*`; blockquote with a nested list; horizontal rule; hard line
  break (`two spaces`); links `[WEB-12](work:WEB-12)`, `[Spec](page:spec-1)`,
  `[Cycle](cycle:<uuid>)`, `[Mod](module:<uuid>)` and an `https://` link; a bare URL;
  an actor mention `@Nina`; raw block HTML `<div class="note">keep me</div>` and inline
  `<kbd>K</kbd>`; an image `![alt](https://example.com/a.png)`; three blank lines in a row.
- Assertions per case: `once = serialise(parse(md))`; `serialise(parse(once)) === once`
  (idempotent after one cycle); `words(once)` ⊇ `words(md)` with
  `words = (s) => s.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/)` (nothing
  dropped); every entity href survives verbatim (`once.includes("(work:WEB-12)")`);
  the raw HTML strings are present as literal text; task states are kept
  (`[x]` count equal); the fenced language is kept.
- Table-driven with `it.each`; the corpus lives in the test file as an array of
  `{ name, md }` so later phases append cases.

## CSS

`src/components/styles/editor.css`: `.tessera-editor` (border, radius, background
tokens), `.tessera-editor-content` (ProseMirror root: `min-height`, typography
tokens, `a[href^="work:"], a[href^="page:"], a[href^="cycle:"], a[href^="module:"]`
drawn as chips), `.tessera-editor--compact`, `.tessera-editor-source`,
`.tessera-editor-popover`, `.tessera-editor-bubble`, `.tessera-editor-drag`,
`.is-editor-empty::before { content: attr(data-placeholder) }` (Placeholder writes
`data-placeholder`), task list and table layout. No hex, no xstyle.
