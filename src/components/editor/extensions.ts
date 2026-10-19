/**
 * Tiptap extension list of the description editor (docs/contracts/editor.md,
 * "Extensions"). No React import: the Vitest round-trip corpus builds a
 * headless `Editor` from the same list the component uses.
 *
 * Besides the contract's extensions, three small nodes keep the Markdown
 * round trip lossless where `@tiptap/markdown` would otherwise rewrite the
 * text: `rawHtml` / `rawHtmlBlock` keep inline and block HTML as literal
 * source (the package would parse known tags through the schema and drop
 * them), and `image` keeps `![alt](src)` (the StarterKit has no image node).
 * A storage-only `suggestionContext` extension holds the actors and the `#`
 * search scope the triggers read at query time (`setSuggestionContext`).
 *
 * Text escaping: `@tiptap/markdown` writes every `&`, `<` and `>` of plain
 * text as an HTML entity, so `R&D: a < b` was stored as `R&amp;D: a &lt; b`
 * (MCP and search readers saw the entities) and any stored description with
 * those characters failed the open-time round-trip check and opened read-only.
 * `TesseraMarkdown` keeps the package's handling of code and its backslash
 * escapes, and escapes `&`, `<` and `>` only where its own parser would read
 * them as markup (`encodeMarkdownText`).
 */
import { Extension, Node, type Editor, type Extensions } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Link } from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Mention, type MentionNodeAttrs } from "@tiptap/extension-mention";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";
import { HeadingIds } from "./heading-ids";
import { ENTITY_LINK_SCHEMES, isAllowedEditorUri } from "./links";

/** One row of a suggestion popover (`#` work items, `@` actors, `/` blocks). */
export type SuggestionRow = {
  id: string;
  label: string;
  /** Work item key, shown as a Token before the label. */
  token?: string;
  description?: string;
  /** Block commands: what to run after the typed range is deleted. */
  run?: (editor: Editor) => void;
};

/**
 * What the `@` and `#` triggers read at query time: the project's actors and
 * the `#` search scope. It lives in the editor's own storage (the
 * `suggestionContext` extension below) so the trigger configs stay static and
 * the host updates it from an effect with `setSuggestionContext`.
 */
export type SuggestionContext = {
  actors: readonly { id: string; name: string }[];
  /** Scope of the `#` search; null outside a project. */
  projectId: string | null;
};

declare module "@tiptap/core" {
  interface Storage {
    suggestionContext: SuggestionContext;
  }
}

/** Trigger config for the plain `Suggestion` plugins (`@`, `#`, `/`). */
export type SuggestionTrigger = Omit<SuggestionOptions<SuggestionRow, SuggestionRow>, "editor">;
/** Trigger config handed to the Mention extension (`[[`); a pick inserts a mention node. */
export type MentionTrigger = Omit<SuggestionOptions<SuggestionRow, MentionNodeAttrs>, "editor">;

/** The four triggers, built by `mentions.tsx` (React) and consumed here. */
export type EditorSuggestions = {
  at: SuggestionTrigger;
  page: MentionTrigger;
  workItem: SuggestionTrigger;
  slash: SuggestionTrigger;
};

export type EditorExtensionOptions = {
  /** Peek mode; kept for parity with the component, the list itself does not change. */
  compact?: boolean;
  placeholder?: string;
  /** Default ENTITY_LINK_SCHEMES. */
  linkSchemes?: readonly string[];
  /** Null in headless use (tests): no suggestion popovers are registered. */
  mentions: EditorSuggestions | null;
};

type SuggestionState = { active: boolean };

export const ACTOR_SUGGEST_KEY = new PluginKey<SuggestionState>("suggest-actor");
export const PAGE_SUGGEST_KEY = new PluginKey<SuggestionState>("suggest-page");
export const WORK_ITEM_SUGGEST_KEY = new PluginKey<SuggestionState>("suggest-work-item");
export const BLOCK_SUGGEST_KEY = new PluginKey<SuggestionState>("suggest-block");

const lowlight = createLowlight(common);

/**
 * Plain text as Markdown the editor's parser reads back as the same text, and
 * escaped no further: the package's backslash escapes for `\` `` ` `` `*` `_`
 * `[` `]` `~`; `&` only where it starts an entity the parser decodes
 * (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#…;`); `<` only where it starts a tag,
 * comment, declaration or autolink; `>` only at the start of the text or of a
 * line (a blockquote marker). `a -> b`, `Q&A` and `$5 < $10` stay as typed.
 */
export function encodeMarkdownText(text: string): string {
  return text
    .replace(/([\\`*_[\]~])/g, "\\$1")
    .replace(/&(?=#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|(?:lt|gt|quot|amp);)/g, "&amp;")
    .replace(/<(?=[A-Za-z/!?])/g, "&lt;")
    .replace(/(^|\n)>/g, "$1\\>");
}

type TextEncoder = (text: string, node: unknown, parentNode: unknown) => string;

/**
 * The Markdown extension with `encodeMarkdownText` for plain text. The
 * package's text encoder is private, so the manager instance gets a wrapper:
 * text the package leaves alone (code marks, code blocks, nothing to escape)
 * stays as it is, and text it would encode is encoded here instead. Every
 * character the package leaves alone this encoder leaves alone too, so the
 * wrapper never escapes inside code.
 */
const TesseraMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    const manager = this.editor.markdown as unknown as { encodeTextForMarkdown?: TextEncoder } | undefined;
    const original = manager?.encodeTextForMarkdown;
    if (manager === undefined || typeof original !== "function") return;
    const encode: TextEncoder = original.bind(manager);
    manager.encodeTextForMarkdown = (text, node, parentNode) => {
      const out = encode(text, node, parentNode);
      return out === text ? out : encodeMarkdownText(text);
    };
  },
});

/** Opening or closing HTML tag at the start of the source, e.g. `<kbd>`, `</kbd>`, `<br/>`. */
const HTML_TAG_RE = /^<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/;

/** String attribute of a ProseMirror node or its JSON form; "" when missing. */
function attrString(attrs: Readonly<Record<string, unknown>> | null | undefined, name: string): string {
  const value = attrs?.[name];
  return typeof value === "string" ? value : "";
}

/** Inline HTML tag kept as literal source text (`<kbd>K</kbd>` stays `<kbd>K</kbd>`). */
const RawHtml = Node.create({
  name: "rawHtml",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { html: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-raw-html]", getAttrs: (element) => ({ html: element.getAttribute("data-raw-html") ?? "" }) }];
  },
  renderHTML({ node }) {
    const html = attrString(node.attrs, "html");
    return ["span", { "data-raw-html": html, class: "tessera-editor-raw" }, html];
  },
  markdownTokenName: "rawHtml",
  markdownTokenizer: {
    name: "rawHtml",
    level: "inline",
    start: (src: string) => src.indexOf("<"),
    tokenize: (src: string) => {
      const match = HTML_TAG_RE.exec(src);
      return match ? { type: "rawHtml", raw: match[0], text: match[0] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("rawHtml", { html: token.raw }),
  renderMarkdown: (node) => attrString(node.attrs, "html"),
});

/** Block HTML kept as literal source text (`<div class="note">…</div>` on its own lines). */
const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { html: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-raw-html]", getAttrs: (element) => ({ html: element.getAttribute("data-raw-html") ?? "" }) }];
  },
  renderHTML({ node }) {
    const html = attrString(node.attrs, "html");
    return ["div", { "data-raw-html": html, class: "tessera-editor-raw-block" }, html];
  },
  markdownTokenName: "html",
  parseMarkdown: (token, helpers) => {
    // An empty array hands the token back to the package (inline HTML is tokenised by RawHtml above).
    if (!token.block) return [];
    const html = String(token.raw ?? token.text ?? "").replace(/\s+$/, "");
    return html ? helpers.createNode("rawHtmlBlock", { html }) : [];
  },
  renderMarkdown: (node) => attrString(node.attrs, "html"),
});

/** Minimal inline image: `![alt](src "title")`. Uploads arrive in a later phase. */
const EditorImage = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" }, title: { default: null } };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", { ...HTMLAttributes, class: "tessera-editor-image" }];
  },
  markdownTokenName: "image",
  parseMarkdown: (token, helpers) =>
    helpers.createNode("image", {
      src: typeof token.href === "string" ? token.href : "",
      alt: typeof token.text === "string" ? token.text : "",
      title: typeof token.title === "string" ? token.title : null,
    }),
  renderMarkdown: (node) => {
    const title = attrString(node.attrs, "title");
    const suffix = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
    return `![${attrString(node.attrs, "alt")}](${attrString(node.attrs, "src")}${suffix})`;
  },
});

/** Reserved `[[` page trigger still uses a mention node; `@` inserts an `actor:` link instead. */
const ActorMention = Mention.extend({
  renderMarkdown: (node) => `@${attrString(node.attrs, "label") || attrString(node.attrs, "id")}`,
});

function mentionLabel(attrs: Record<string, unknown>): string {
  const label = attrs.label;
  const id = attrs.id;
  return typeof label === "string" && label ? label : typeof id === "string" ? id : "";
}

const EMPTY_SUGGESTION_CONTEXT: SuggestionContext = { actors: [], projectId: null };

/** Holds the SuggestionContext of one editor instance (no plugins, storage only). */
const SuggestionContextExtension = Extension.create<Record<string, never>, SuggestionContext>({
  name: "suggestionContext",
  addStorage() {
    return { ...EMPTY_SUGGESTION_CONTEXT };
  },
});

/** The actors and search scope the triggers of `editor` currently use. */
export function readSuggestionContext(editor: Editor): SuggestionContext {
  return (editor.storage as Partial<Editor["storage"]>).suggestionContext ?? EMPTY_SUGGESTION_CONTEXT;
}

/** Replaces the actors and search scope the triggers of `editor` read on their next query. */
export function setSuggestionContext(editor: Editor, next: SuggestionContext): void {
  const storage = (editor.storage as Partial<Editor["storage"]>).suggestionContext;
  if (!storage) return;
  storage.actors = next.actors;
  storage.projectId = next.projectId;
}

/** Wraps one `Suggestion` plugin in an extension so it can sit in the extension list. */
function suggestionExtension(name: string, trigger: SuggestionTrigger) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [Suggestion<SuggestionRow, SuggestionRow>({ editor: this.editor, ...trigger })];
    },
  });
}

/** The extension list; the component and the round-trip tests share it. */
export function editorExtensions(options: EditorExtensionOptions): Extensions {
  const schemes = [...(options.linkSchemes ?? ENTITY_LINK_SCHEMES)];
  const { mentions } = options;
  const list: Extensions = [
    StarterKit.configure({ link: false, codeBlock: false }),
    HeadingIds,
    TesseraMarkdown,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: schemes,
      isAllowedUri: (url, ctx) => isAllowedEditorUri(url, ctx.protocols) || ctx.defaultValidate(url),
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder: options.placeholder ?? "", showOnlyWhenEditable: true }),
    RawHtml,
    RawHtmlBlock,
    EditorImage,
    SuggestionContextExtension,
    ActorMention.configure({
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => `@${mentionLabel(node.attrs)}`,
      renderHTML: ({ node }) => [
        "span",
        {
          "data-type": "mention",
          "data-id": node.attrs.id,
          "data-label": node.attrs.label,
          "data-mention-suggestion-char": "[[",
          class: "tessera-editor-mention",
        },
        `@${mentionLabel(node.attrs)}`,
      ],
      suggestions: mentions ? [mentions.page] : [],
    }),
  ];
  if (mentions) {
    list.push(
      suggestionExtension("actor-suggest", mentions.at),
      suggestionExtension("work-item-suggest", mentions.workItem),
      suggestionExtension("block-suggest", mentions.slash),
    );
  }
  return list;
}
