/**
 * Stable `id` attributes on heading nodes so the page Outline can scroll-spy
 * and jump (docs/drafts/p10-plan.md "Page outline"). Ids are not written into
 * Markdown; they are rebuilt from heading text whenever the doc changes.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("headingIds"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = newState.tr;
          let modified = false;
          const used = new Set<string>();
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "heading") return;
            const id = uniqueHeadingId(headingSlug(node.textContent), used);
            if (node.attrs.id === id) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
            modified = true;
          });
          return modified ? tr : null;
        },
      }),
    ];
  },
});
