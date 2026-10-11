"use client";

import {useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent} from "react";
import {createPortal} from "react-dom";
import {useRouter} from "next/navigation";
import {
  Code,
  Copy,
  DotsSixVertical,
  Link,
  ListBullets,
  ListNumbers,
  Minus,
  Plus,
  Table,
  TextB,
  TextH,
  TextItalic,
  TextStrikethrough,
  TextT,
  Trash,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import {ButtonGroup} from "@astryxdesign/core/ButtonGroup";
import {Card} from "@astryxdesign/core/Card";
import {IconButton} from "@astryxdesign/core/IconButton";
import {List, ListItem} from "@astryxdesign/core/List";
import {HStack, VStack} from "@astryxdesign/core/Layout";
import {TextInput} from "@astryxdesign/core/TextInput";
import type {Ctx} from "@milkdown/kit/ctx";
import {commandsCtx, Editor, defaultValueCtx, editorViewCtx, rootCtx} from "@milkdown/kit/core";
import {history} from "@milkdown/kit/plugin/history";
import {listener, listenerCtx} from "@milkdown/kit/plugin/listener";
import {block, BlockProvider, blockConfig} from "@milkdown/kit/plugin/block";
import {cursor, dropIndicatorConfig} from "@milkdown/kit/plugin/cursor";
import {SlashProvider, slashFactory} from "@milkdown/kit/plugin/slash";
import {TooltipProvider, tooltipFactory} from "@milkdown/kit/plugin/tooltip";
import {flip, offset, shift} from "@floating-ui/dom";
import {findParent} from "@milkdown/kit/prose";
import type {EditorView} from "@milkdown/kit/prose/view";
import {TextSelection, type EditorState, type PluginView} from "@milkdown/kit/prose/state";
import {
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  commonmark,
  headingIdGenerator,
  headingSchema,
  insertHrCommand,
  paragraphSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import {gfm, insertTableCommand, toggleStrikethroughCommand} from "@milkdown/kit/preset/gfm";
import {callCommand, type $Command} from "@milkdown/kit/utils";
import {Milkdown, useEditor} from "@milkdown/react";
import {DocumentTableControls, tableControlsPlugin} from "./document-table";

const ITEM_LINK = /\]\(item:([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;
const PAGE_LINK = /\]\(\/items\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;
const slash = slashFactory("HANDBOOK");
const selectionToolbar = tooltipFactory("HANDBOOK_TOOLBAR");

interface MenuState {
  open: boolean;
  query: string;
  index: number;
}

interface SelectionMarks {
  strong: boolean;
  emphasis: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
}

interface EditorApi {
  get: () => {action: (fn: (ctx: Ctx) => void) => void} | undefined;
  block: BlockProvider | null;
  slash: SlashProvider | null;
  selection: TooltipProvider | null;
  blockMenuOpen: boolean;
  tableMenuOpen: boolean;
  forcedPos: number | null;
  setHandleHost: (element: HTMLDivElement) => void;
  setMenuHost: (element: HTMLDivElement) => void;
  setSelectionHost: (element: HTMLDivElement) => void;
  setTableHost: (element: HTMLDivElement | null) => void;
  tableChanged: () => void;
  publishMenu: (patch: Partial<MenuState>) => void;
  publishSelection: (marks: SelectionMarks | null) => void;
}

interface SlashItem {
  id: string;
  label: string;
  description: string;
  keywords: string;
  icon: PhosphorIcon;
  run: (ctx: Ctx) => void;
}

const slashItems: SlashItem[] = [
  {
    id: "text",
    label: "Text",
    description: "Paragraph",
    keywords: "text paragraph",
    icon: TextT,
    run: (ctx) => ctx.get(commandsCtx).call(turnIntoTextCommand.key),
  },
  {
    id: "heading",
    label: "Heading",
    description: "Section title",
    keywords: "heading h2 title",
    icon: TextH,
    run: (ctx) =>
      ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
        nodeType: headingSchema.type(ctx),
        attrs: {level: 2},
      }),
  },
  {
    id: "list",
    label: "List",
    description: "Bulleted list",
    keywords: "list bullet ul",
    icon: ListBullets,
    run: (ctx) => ctx.get(commandsCtx).call(wrapInBulletListCommand.key),
  },
  {
    id: "steps",
    label: "Steps",
    description: "Numbered list",
    keywords: "steps numbered ordered ol",
    icon: ListNumbers,
    run: (ctx) => ctx.get(commandsCtx).call(wrapInOrderedListCommand.key),
  },
  {
    id: "table",
    label: "Table",
    description: "3 by 3",
    keywords: "table grid",
    icon: Table,
    run: (ctx) => ctx.get(commandsCtx).call(insertTableCommand.key, {row: 3, col: 3}),
  },
  {
    id: "code",
    label: "Code",
    description: "Code block",
    keywords: "code block",
    icon: Code,
    run: (ctx) =>
      ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
        nodeType: codeBlockSchema.type(ctx),
      }),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal line",
    keywords: "divider hr line",
    icon: Minus,
    run: (ctx) => ctx.get(commandsCtx).call(insertHrCommand.key),
  },
];

function toEditor(markdown: string) {
  return markdown.replace(ITEM_LINK, "](/items/$1)");
}

function toFile(markdown: string) {
  return markdown.replace(PAGE_LINK, "](item:$1)");
}

function glyph(IconComponent: PhosphorIcon, size = 18) {
  return <IconComponent weight="duotone" size={size} aria-hidden />;
}

function visibleItems(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return slashItems;
  return slashItems.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) || item.keywords.includes(needle),
  );
}

function activeSlash(view: EditorView) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const parent = selection.$from.parent;
  if (parent.type.name !== "paragraph" && parent.type.name !== "heading") return null;
  const before = parent.textBetween(0, selection.$from.parentOffset, undefined, "\uFFFC");
  const slash = before.lastIndexOf("/");
  if (slash < 0) return null;
  const query = before.slice(slash + 1);
  if (/\s/.test(query)) return null;
  return {
    from: selection.$from.start() + slash,
    to: selection.$from.pos,
    query,
  };
}

function inForcedBlock(view: EditorView, pos: number) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || selection.$from.depth < 1) return false;
  const maxSize = Math.max(1, view.state.doc.nodeSize - 2);
  const forced = view.state.doc.resolve(Math.min(Math.max(pos, 1), maxSize));
  return forced.depth > 0 && forced.before() === selection.$from.before();
}

function menuShouldShow(view: EditorView, provider: SlashProvider, api: EditorApi) {
  const menuFocused = provider.element.contains(document.activeElement);
  if (!view.hasFocus() && !menuFocused) return false;

  if (typeof api.forcedPos === "number" && inForcedBlock(view, api.forcedPos)) {
    const selection = view.state.selection;
    if (!(selection instanceof TextSelection)) return false;
    const typed = selection.$from.parent.textBetween(
      0,
      selection.$from.parentOffset,
      undefined,
      "\uFFFC",
    );
    const query = typed.replace(/^\//, "");
    if (visibleItems(query).length === 0) return false;
    api.publishMenu({query});
    return true;
  }
  api.forcedPos = null;

  const slash = activeSlash(view);
  if (!slash || visibleItems(slash.query).length === 0) return false;
  api.publishMenu({query: slash.query});
  return true;
}

class BlockHandleView implements PluginView {
  readonly #provider: BlockProvider;
  readonly #content: HTMLDivElement;

  constructor(ctx: Ctx, api: EditorApi) {
    const content = document.createElement("div");
    content.className = "handbook-block-handle";
    this.#content = content;
    api.setHandleHost(content);
    this.#provider = new BlockProvider({
      ctx,
      content,
      getOffset: () => 8,
      getPlacement: () => "left-start",
      getPosition: ({active, editorDom}) => {
        const rect = active.el.getBoundingClientRect();
        const editor = editorDom.getBoundingClientRect();
        // Tables carry their own row handles in the gutter, so the block
        // handle moves further left to leave room for them.
        const tableRoom = active.node.type.name === "table" ? 36 : 0;
        const left =
          editor.left +
          parseFloat(getComputedStyle(editorDom).paddingInlineStart) -
          tableRoom;
        return new DOMRect(left, rect.top, rect.width, rect.height);
      },
    });
    api.block = this.#provider;
    this.update();
  }

  update = () => {
    this.#provider.update();
  };

  destroy = () => {
    this.#provider.destroy();
    this.#content.remove();
  };
}

function readSelectionMarks(view: EditorView): SelectionMarks {
  const {doc, selection, schema} = view.state;
  const marked = (name: string) => {
    const type = schema.marks[name];
    return Boolean(type && doc.rangeHasMark(selection.from, selection.to, type));
  };
  return {
    strong: marked("strong"),
    emphasis: marked("emphasis"),
    strike: marked("strike_through"),
    code: marked("inlineCode"),
    link: marked("link"),
  };
}

function selectionShouldShow(view: EditorView, content: HTMLElement, api: EditorApi) {
  if (api.blockMenuOpen || api.tableMenuOpen) return false;
  const {doc, selection} = view.state;
  const {empty, from, to} = selection;
  const isEmptyTextBlock =
    !doc.textBetween(from, to).length && selection instanceof TextSelection;
  const activeElement = (view.dom.getRootNode() as ShadowRoot | Document).activeElement;
  const insideToolbar = content.contains(activeElement);
  if (!view.hasFocus() && !insideToolbar) return false;
  if (!(selection instanceof TextSelection) || empty || isEmptyTextBlock || !view.editable) {
    return false;
  }
  return true;
}

class SelectionToolbarView implements PluginView {
  readonly #provider: TooltipProvider;
  readonly #content: HTMLDivElement;
  #view: EditorView;

  constructor(view: EditorView, api: EditorApi) {
    const content = document.createElement("div");
    content.className = "handbook-selection-toolbar";
    content.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea")) return;
      event.preventDefault();
    });
    this.#content = content;
    this.#view = view;
    api.setSelectionHost(content);
    this.#provider = new TooltipProvider({
      content,
      debounce: 20,
      offset: 10,
      shouldShow: (nextView) => {
        const show = selectionShouldShow(nextView, content, api);
        if (show) api.publishSelection(readSelectionMarks(nextView));
        return show;
      },
      floatingUIOptions: {
        placement: "top",
        middleware: [offset(10), flip({padding: 8}), shift({padding: 8})],
      },
    });
    api.selection = this.#provider;
    this.#provider.onShow = () => api.publishSelection(readSelectionMarks(this.#view));
    this.#provider.onHide = () => api.publishSelection(null);
    this.update(view);
  }

  update = (view: EditorView, prevState?: EditorState) => {
    this.#view = view;
    this.#provider.update(view, prevState);
  };

  destroy = () => {
    this.#provider.destroy();
    this.#content.remove();
  };
}

class SlashMenuView implements PluginView {
  readonly #provider: SlashProvider;
  readonly #content: HTMLDivElement;

  constructor(view: EditorView, api: EditorApi) {
    const content = document.createElement("div");
    content.className = "handbook-slash-menu";
    content.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    this.#content = content;
    api.setMenuHost(content);
    const provider: SlashProvider = new SlashProvider({
      content,
      debounce: 0,
      shouldShow: (nextView) => menuShouldShow(nextView, provider, api),
      floatingUIOptions: {
        placement: "bottom-start",
        middleware: [offset(6), flip({padding: 8, fallbackStrategy: "initialPlacement"}), shift({padding: 8})],
      },
    });
    this.#provider = provider;
    api.slash = provider;
    provider.onShow = () => api.publishMenu({open: true});
    provider.onHide = () => {
      api.forcedPos = null;
      api.publishMenu({open: false, query: ""});
    };
    this.update(view);
  }

  update = (view: EditorView) => {
    this.#provider.update(view);
  };

  destroy = () => {
    this.#provider.destroy();
    this.#content.remove();
  };
}

interface BlockMenuState {
  top: number;
  left: number;
  from: number;
}

export function PageBody({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (markdown: string) => void;
}) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [handleHost, setHandleHost] = useState<HTMLDivElement | null>(null);
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  const [selectionHost, setSelectionHost] = useState<HTMLDivElement | null>(null);
  const [tableHost, setTableHost] = useState<HTMLDivElement | null>(null);
  const [tableTick, setTableTick] = useState(0);
  const [selectionMarks, setSelectionMarks] = useState<SelectionMarks | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const linkRange = useRef<{from: number; to: number} | null>(null);
  const [blockMenu, setBlockMenu] = useState<BlockMenuState | null>(null);
  const [blockQuery, setBlockQuery] = useState("");
  const gripPoint = useRef({x: 0, y: 0, dragged: false});
  const [menu, setMenu] = useState<MenuState>({open: false, query: "", index: 0});
  const api = useRef<EditorApi>({
    get: () => undefined,
    block: null,
    slash: null,
    selection: null,
    blockMenuOpen: false,
    tableMenuOpen: false,
    forcedPos: null,
    setHandleHost,
    setMenuHost,
    setSelectionHost,
    setTableHost,
    tableChanged: () => setTableTick((value) => value + 1),
    publishSelection: (marks) => {
      setSelectionMarks((prev) => {
        if (!marks) return prev ? null : prev;
        if (
          prev &&
          prev.strong === marks.strong &&
          prev.emphasis === marks.emphasis &&
          prev.strike === marks.strike &&
          prev.code === marks.code &&
          prev.link === marks.link
        ) {
          return prev;
        }
        return marks;
      });
      if (!marks) setLinking(false);
    },
    publishMenu: (patch) => {
      setMenu((prev) => {
        const query = patch.query ?? prev.query;
        const open = patch.open ?? prev.open;
        const index =
          patch.query !== undefined && patch.query !== prev.query
            ? 0
            : (patch.index ?? prev.index);
        if (open === prev.open && query === prev.query && index === prev.index) {
          return prev;
        }
        return {open, query, index};
      });
    },
  });

  const {get} = useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, toEditor(initial));
        ctx.set(blockConfig.key, {
          filterNodes: (pos, node) => {
            if (node.type.name === "table") return true;
            return !findParent((parent) => parent.type.name === "table")(pos);
          },
        });
        ctx.set(block.key, {
          view: () => new BlockHandleView(ctx, api.current),
        });
        ctx.set(slash.key, {
          view: (view) => new SlashMenuView(view, api.current),
        });
        ctx.set(selectionToolbar.key, {
          view: (view) => new SelectionToolbarView(view, api.current),
        });
        ctx.set(dropIndicatorConfig.key, {
          width: 2,
          color: "var(--color-accent)",
          class: "milkdown-drop-indicator",
        });
        ctx.set(headingIdGenerator.key, (node) => {
          const slug = node.textContent
            .trim()
            .toLowerCase()
            .replace(/['"]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
          return slug || "section";
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(tableControlsPlugin(api.current))
      .use(history)
      .use(listener)
      .use(cursor)
      .use(block)
      .use(slash)
      .use(selectionToolbar)
      .config((ctx) => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onChangeRef.current(toFile(markdown).replace(/\s+$/, ""));
        });
      }),
  );
  api.current.get = get;

  const onTableMenu = useCallback((open: boolean) => {
    api.current.tableMenuOpen = open;
    if (open) api.current.selection?.hide();
  }, []);

  const items = visibleItems(menu.query);
  const activeIndex = Math.min(menu.index, Math.max(items.length - 1, 0));

  const runSlash = (item: SlashItem) => {
    api.current.forcedPos = null;
    api.current.slash?.hide();
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const slash = activeSlash(view);
      if (!slash) {
        ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
        item.run(ctx);
        return;
      }
      const $from = view.state.doc.resolve(slash.from);
      const leftover =
        $from.parent.textBetween(0, slash.from - $from.start()) +
        $from.parent.textBetween(slash.to - $from.start(), $from.parent.content.size);
      if (leftover.trim() === "") {
        view.dispatch(view.state.tr.delete(slash.from, slash.to));
        item.run(ctx);
        return;
      }
      const blockEnd = $from.after();
      let tr = view.state.tr.delete(slash.from, slash.to);
      const at = tr.mapping.map(blockEnd);
      tr = tr.insert(at, paragraphSchema.type(ctx).create());
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
      view.dispatch(tr.scrollIntoView());
      item.run(ctx);
    });
  };

  useEffect(() => {
    if (!menu.open) return;
    const onKey = (event: KeyboardEvent) => {
      const choices = visibleItems(menu.query);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        api.current.slash?.hide();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setMenu((prev) => ({
          ...prev,
          index: Math.min(prev.index + 1, Math.max(choices.length - 1, 0)),
        }));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setMenu((prev) => ({...prev, index: Math.max(prev.index - 1, 0)}));
        return;
      }
      if (event.key === "Enter" && choices.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        const choice = choices[Math.min(menu.index, choices.length - 1)];
        if (choice) runSlash(choice);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [get, menu.index, menu.open, menu.query]);

  useEffect(() => {
    api.current.blockMenuOpen = blockMenu !== null;
    if (blockMenu) api.current.selection?.hide();
    if (!blockMenu) return;
    const close = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".handbook-block-menu")) return;
      setBlockMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBlockMenu(null);
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", close);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [blockMenu]);

  const run = <T,>(command: $Command<T>, payload?: T) => {
    get()?.action(callCommand(command.key, payload));
  };

  const keepSelection = (event: MouseEvent) => {
    event.preventDefault();
  };

  const editLink = () => {
    if (selectionMarks?.link) {
      run(toggleLinkCommand);
      return;
    }
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      linkRange.current = {from: view.state.selection.from, to: view.state.selection.to};
    });
    setLinkHref("");
    setLinking(true);
  };

  const applyLink = () => {
    const href = linkHref.trim();
    const range = linkRange.current;
    if (!href || !range) return;
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)),
      );
      ctx.get(commandsCtx).call(toggleLinkCommand.key, {href});
    });
    setLinking(false);
  };

  const stopDrag = (event: MouseEvent | PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const focusBlock = (ctx: Ctx, from: number) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(from);
    if (!node) return false;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(from + 1))),
    );
    return true;
  };

  const blockActions: Array<{
    id: string;
    label: string;
    keywords: string;
    icon: PhosphorIcon;
    run: (ctx: Ctx, from: number) => void;
  }> = [
    {
      id: "text",
      label: "Text",
      keywords: "turn into paragraph",
      icon: TextT,
      run: (ctx, from) => {
        if (!focusBlock(ctx, from)) return;
        ctx.get(commandsCtx).call(turnIntoTextCommand.key);
      },
    },
    {
      id: "heading",
      label: "Heading",
      keywords: "turn into h2",
      icon: TextH,
      run: (ctx, from) => {
        if (!focusBlock(ctx, from)) return;
        ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
          nodeType: headingSchema.type(ctx),
          attrs: {level: 2},
        });
      },
    },
    {
      id: "list",
      label: "List",
      keywords: "turn into bullet",
      icon: ListBullets,
      run: (ctx, from) => {
        if (!focusBlock(ctx, from)) return;
        ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
      },
    },
    {
      id: "steps",
      label: "Steps",
      keywords: "turn into numbered",
      icon: ListNumbers,
      run: (ctx, from) => {
        if (!focusBlock(ctx, from)) return;
        ctx.get(commandsCtx).call(wrapInOrderedListCommand.key);
      },
    },
    {
      id: "code",
      label: "Code",
      keywords: "turn into code block",
      icon: Code,
      run: (ctx, from) => {
        if (!focusBlock(ctx, from)) return;
        ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
          nodeType: codeBlockSchema.type(ctx),
        });
      },
    },
    {
      id: "duplicate",
      label: "Duplicate",
      keywords: "copy block",
      icon: Copy,
      run: (ctx, from) => {
        const view = ctx.get(editorViewCtx);
        const node = view.state.doc.nodeAt(from);
        if (!node) return;
        view.dispatch(view.state.tr.insert(from + node.nodeSize, node.copy(node.content)));
      },
    },
    {
      id: "delete",
      label: "Delete",
      keywords: "remove block",
      icon: Trash,
      run: (ctx, from) => {
        const view = ctx.get(editorViewCtx);
        const node = view.state.doc.nodeAt(from);
        if (!node) return;
        const to = from + node.nodeSize;
        if (view.state.doc.childCount <= 1) {
          view.dispatch(view.state.tr.replaceWith(from, to, paragraphSchema.type(ctx).create()));
          return;
        }
        view.dispatch(view.state.tr.delete(from, to));
      },
    },
  ];

  const visibleBlockActions = blockActions.filter((action) => {
    const needle = blockQuery.trim().toLowerCase();
    if (!needle) return true;
    return action.label.toLowerCase().includes(needle) || action.keywords.includes(needle);
  });

  const runBlockAction = (action: (typeof blockActions)[number]) => {
    const from = blockMenu?.from;
    if (from == null) return;
    get()?.action((ctx) => action.run(ctx, from));
    setBlockMenu(null);
  };

  const gripDown = (event: PointerEvent) => {
    gripPoint.current = {x: event.clientX, y: event.clientY, dragged: false};
  };

  const gripMove = (event: PointerEvent) => {
    const dx = event.clientX - gripPoint.current.x;
    const dy = event.clientY - gripPoint.current.y;
    if (dx * dx + dy * dy > 16) gripPoint.current.dragged = true;
  };

  const openBlockMenu = (event: PointerEvent) => {
    if (gripPoint.current.dragged) return;
    const active = api.current.block?.active;
    if (!active) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const room = window.innerHeight - 16;
    setBlockQuery("");
    setBlockMenu({
      top: Math.max(8, Math.min(rect.top, room - 360)),
      left: Math.min(rect.right + 8, window.innerWidth - 272),
      from: active.$pos.pos,
    });
  };

  const placeBlockMenu = (node: HTMLElement | null) => {
    if (!node || !blockMenu) return;
    const height = node.getBoundingClientRect().height;
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    if (blockMenu.top <= maxTop) return;
    setBlockMenu((current) => (current ? {...current, top: maxTop} : current));
  };

  const addBlock = () => {
    const active = api.current.block?.active;
    if (!active) return;
    get()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view.hasFocus()) view.focus();
      const insertAt = active.$pos.pos + active.node.nodeSize;
      let tr = view.state.tr.insert(insertAt, paragraphSchema.type(ctx).create());
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt)));
      api.current.forcedPos = tr.selection.from;
      view.dispatch(tr.scrollIntoView());
      api.current.slash?.show();
    });
    api.current.block?.hide();
  };

  const openPageLink = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const href = target?.closest("a")?.getAttribute("href") ?? "";
    const page = href.startsWith("item:")
      ? href.slice(5)
      : href.startsWith("/items/")
        ? href.slice("/items/".length)
        : "";
    if (!page || page.includes("/")) return;
    event.preventDefault();
    router.push(`/items/${page}`);
  };

  return (
    <VStack>
      <VStack onClickCapture={openPageLink}>
        <Milkdown />
      </VStack>
      <DocumentTableControls
        get={get}
        host={tableHost}
        tick={tableTick}
        onMenuOpenChange={onTableMenu}
      />
      {handleHost
        ? createPortal(
            <HStack gap={1} vAlign="center">
              <IconButton
                label="Add a block"
                tooltip="Add a block"
                variant="ghost"
                size="sm"
                icon={glyph(Plus)}
                onPointerDown={stopDrag}
                onMouseDown={stopDrag}
                onClick={addBlock}
              />
              <HStack
                aria-label="Block actions"
                onPointerDown={gripDown}
                onPointerMove={gripMove}
                onPointerUp={openBlockMenu}
              >
                {glyph(DotsSixVertical)}
              </HStack>
            </HStack>,
            handleHost,
          )
        : null}
      {menuHost
        ? createPortal(
            <Card padding={2}>
              <List density="compact" aria-label="Insert">
                {items.map((item, index) => (
                  <ListItem
                    key={item.id}
                    label={item.label}
                    description={item.description}
                    startContent={glyph(item.icon, 18)}
                    isSelected={menu.open && index === activeIndex}
                    onClick={() => runSlash(item)}
                  />
                ))}
              </List>
            </Card>,
            menuHost,
          )
        : null}
      {selectionHost
        ? createPortal(
            <Card padding={2}>
              <VStack gap={2}>
                <HStack gap={2} vAlign="center">
                  <ButtonGroup label="Format selection" size="sm">
                    <IconButton
                      label="Bold"
                      tooltip="Bold"
                      variant={selectionMarks?.strong ? "secondary" : "ghost"}
                      size="sm"
                      icon={glyph(TextB)}
                      onMouseDown={keepSelection}
                      onClick={() => run(toggleStrongCommand)}
                    />
                    <IconButton
                      label="Italic"
                      tooltip="Italic"
                      variant={selectionMarks?.emphasis ? "secondary" : "ghost"}
                      size="sm"
                      icon={glyph(TextItalic)}
                      onMouseDown={keepSelection}
                      onClick={() => run(toggleEmphasisCommand)}
                    />
                    <IconButton
                      label="Strikethrough"
                      tooltip="Strikethrough"
                      variant={selectionMarks?.strike ? "secondary" : "ghost"}
                      size="sm"
                      icon={glyph(TextStrikethrough)}
                      onMouseDown={keepSelection}
                      onClick={() => run(toggleStrikethroughCommand)}
                    />
                  </ButtonGroup>
                  <ButtonGroup label="Insert in selection" size="sm">
                    <IconButton
                      label="Code"
                      tooltip="Code"
                      variant={selectionMarks?.code ? "secondary" : "ghost"}
                      size="sm"
                      icon={glyph(Code)}
                      onMouseDown={keepSelection}
                      onClick={() => run(toggleInlineCodeCommand)}
                    />
                    <IconButton
                      label="Link"
                      tooltip="Link"
                      variant={selectionMarks?.link || linking ? "secondary" : "ghost"}
                      size="sm"
                      icon={glyph(Link)}
                      onMouseDown={keepSelection}
                      onClick={editLink}
                    />
                  </ButtonGroup>
                </HStack>
                {linking ? (
                  <TextInput
                    label="Link address"
                    isLabelHidden
                    value={linkHref}
                    onChange={setLinkHref}
                    placeholder="https://"
                    hasAutoFocus
                    autoComplete="off"
                    width="16rem"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyLink();
                      }
                      if (event.key === "Escape") setLinking(false);
                    }}
                  />
                ) : null}
              </VStack>
            </Card>,
            selectionHost,
          )
        : null}
      {blockMenu
        ? createPortal(
            <VStack
              ref={placeBlockMenu}
              className="handbook-block-menu"
              style={{top: blockMenu.top, left: blockMenu.left}}
              gap={2}
            >
              <Card padding={2}>
                <VStack gap={2}>
                  <TextInput
                    label="Search actions"
                    isLabelHidden
                    value={blockQuery}
                    onChange={setBlockQuery}
                    placeholder="Search actions"
                    hasAutoFocus
                    autoComplete="off"
                    width="100%"
                  />
                  <List density="compact" aria-label="Block actions">
                    {visibleBlockActions.map((action) => (
                      <ListItem
                        key={action.id}
                        label={action.label}
                        startContent={glyph(action.icon)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runBlockAction(action)}
                      />
                    ))}
                  </List>
                </VStack>
              </Card>
            </VStack>,
            document.body,
          )
        : null}
    </VStack>
  );
}
