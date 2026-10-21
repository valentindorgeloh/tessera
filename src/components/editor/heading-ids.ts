/**
 * Stable `id` attributes on heading nodes so the page Outline can scroll-spy
 * and jump (docs/drafts/p10-plan.md "Page outline"). Ids are not written into
 * Markdown; they are rebuilt from heading text whenever the doc changes.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";

/** Lowercase slug for an outline anchor; empty text becomes "heading". */
export function headingSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "heading" : slug;
}

/** Unique id among those already used in the document. */
export function uniqueHeadingId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * A transaction that gives every heading its id, or null when all are set.
 * Shared by the plugin (every doc change) and `onCreate` (the initial doc,
 * which is built from `content` and never passes through a transaction).
 */
export function headingIdTransaction(state: EditorState): Transaction | null {
  const tr = state.tr;
  let modified = false;
  const used = new Set<string>();
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const id = uniqueHeadingId(headingSlug(node.textContent), used);
    if (node.attrs.id === id) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
    modified = true;
  });
  return modified ? tr : null;
}

export const HeadingIds = Extension.create({
  name: "headingIds",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("id"),
            renderHTML: (attributes) => (attributes.id ? { id: attributes.id as string } : {}),
          },
        },
      },
    ];
  },

  // The initial content has no ids until the first edit otherwise, so the Outline would read "No headings yet".
  onCreate() {
    const { editor } = this;
    if (editor.isDestroyed) return;
    const tr = headingIdTransaction(editor.state);
    // Not an edit: no update event (the page would save an identical body) and no undo step.
    if (tr) editor.view.dispatch(tr.setMeta("preventUpdate", true).setMeta("addToHistory", false));
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("headingIds"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          return headingIdTransaction(newState);
        },
      }),
    ];
  },
});
