"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {createPortal} from "react-dom";
import {
  ColumnsPlusLeft,
  ColumnsPlusRight,
  Copy,
  DotsSix,
  DotsSixVertical,
  Eraser,
  FunnelSimple,
  Plus,
  RowsPlusBottom,
  RowsPlusTop,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextT,
  Trash,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import {Button} from "@astryxdesign/core/Button";
import {DropdownMenu, type DropdownMenuOption} from "@astryxdesign/core/DropdownMenu";
import {IconButton} from "@astryxdesign/core/IconButton";
import {HStack, VStack} from "@astryxdesign/core/Layout";
import {Text} from "@astryxdesign/core/Text";
import {TextInput} from "@astryxdesign/core/TextInput";
import {Toolbar} from "@astryxdesign/core/Toolbar";
import type {Ctx} from "@milkdown/kit/ctx";
import {commandsCtx, editorViewCtx} from "@milkdown/kit/core";
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  goToNextTableCellCommand,
  moveColCommand,
  moveRowCommand,
  selectColCommand,
  selectRowCommand,
  setAlignCommand,
} from "@milkdown/kit/preset/gfm";
import type {Node} from "@milkdown/kit/prose/model";
import {Plugin, PluginKey, Selection, TextSelection, type EditorState} from "@milkdown/kit/prose/state";
import {CellSelection, TableMap, goToNextCell} from "@milkdown/kit/prose/tables";
import {Decoration, DecorationSet, type EditorView} from "@milkdown/kit/prose/view";
import {$prose} from "@milkdown/kit/utils";

type EditorGetter = () => {action: (fn: (ctx: Ctx) => void) => void} | undefined;

type Axis = "row" | "col";

export interface TableBridge {
  setTableHost: (host: HTMLDivElement | null) => void;
  tableChanged: () => void;
}

interface Hover {
  tablePos: number;
  row: number;
  col: number;
}

interface Drag {
  axis: Axis;
  from: number;
  to: number;
  ghost: HTMLElement;
  offset: number;
  pointer: number;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TableFilter {
  pos: number;
  query: string;
}

interface TableState {
  hidden: DecorationSet;
  filters: TableFilter[];
}

interface TableMeta {
  hidden?: number[] | null;
  filter?: TableFilter;
}

const HOVER_MARGIN = 28;
const DRAG_THRESHOLD = 16;
const ADD_STEP: Record<Axis, number> = {col: 120, row: 40};
const TOOLBAR_ROOM = 44;
const TABLE_KEY = new PluginKey<TableState>("HANDBOOK_TABLE_CONTROLS");

function tableStateOf(state: EditorState): TableState {
  return TABLE_KEY.getState(state) ?? {hidden: DecorationSet.empty, filters: []};
}

/**
 * Creates the overlay host next to the editor DOM, reports document changes so
 * the React controls re-measure, hides cells while a row or column is being
 * dragged, outlines a cell selection, hides rows that fall outside a table's
 * filter, and adds the table keyboard shortcuts.
 */
export function tableControlsPlugin(bridge: TableBridge) {
  return $prose(
    (ctx) =>
      new Plugin<TableState>({
        key: TABLE_KEY,
        state: {
          init: () => ({hidden: DecorationSet.empty, filters: []}),
          apply: (tr, previous) => {
            const meta = tr.getMeta(TABLE_KEY) as TableMeta | undefined;
            let hidden = previous.hidden.map(tr.mapping, tr.doc);
            if (meta && meta.hidden !== undefined) {
              const decorations: Decoration[] = [];
              for (const pos of meta.hidden ?? []) {
                const node = tr.doc.nodeAt(pos);
                if (node) {
                  decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {class: "handbook-cell-hidden"}),
                  );
                }
              }
              hidden = DecorationSet.create(tr.doc, decorations);
            }
            let filters = previous.filters;
            if (tr.docChanged) {
              filters = filters
                .map((filter) => ({...filter, pos: tr.mapping.map(filter.pos)}))
                .filter((filter) => tr.doc.nodeAt(filter.pos)?.type.name === "table");
            }
            if (meta?.filter) {
              const {pos, query} = meta.filter;
              filters = filters.filter((filter) => filter.pos !== pos);
              if (query) filters = [...filters, {pos, query}];
            }
            return {hidden, filters};
          },
        },
        props: {
          decorations: (state) => {
            const {hidden, filters} = tableStateOf(state);
            const extra = [...(outlineDecorations(state) ?? []), ...filterDecorations(state, filters)];
            return extra.length > 0 ? hidden.add(state.doc, extra) : hidden;
          },
          handleDOMEvents: {
            keydown: (view, event) => handleTableKey(ctx, view, event),
          },
        },
        view: (view) => {
          const host = document.createElement("div");
          host.className = "handbook-table-controls";
          view.dom.parentElement?.appendChild(host);
          bridge.setTableHost(host);
          return {
            update: (nextView, prevState) => {
              if (
                nextView.state.doc !== prevState.doc ||
                tableStateOf(nextView.state).filters !== tableStateOf(prevState).filters
              ) {
                bridge.tableChanged();
              }
            },
            destroy: () => {
              bridge.setTableHost(null);
              host.remove();
            },
          };
        },
      }),
  );
}

function outlineDecorations(state: EditorState) {
  const {selection} = state;
  if (!(selection instanceof CellSelection)) return null;
  const $table = tableAround(selection.$anchorCell);
  if (!$table) return null;
  const map = TableMap.get($table.node);
  const cells: Array<{pos: number; node: Node; rect: ReturnType<TableMap["findCell"]>}> = [];
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;
  selection.forEachCell((node, pos) => {
    const rect = map.findCell(pos - $table.start);
    cells.push({pos, node, rect});
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    bottom = Math.max(bottom, rect.bottom);
    right = Math.max(right, rect.right);
  });
  return cells.map(({pos, node, rect}) => {
    const classes = ["handbook-cell-selected"];
    if (rect.top === top) classes.push("handbook-cell-edge-top");
    if (rect.left === left) classes.push("handbook-cell-edge-left");
    if (rect.bottom === bottom) classes.push("handbook-cell-edge-bottom");
    if (rect.right === right) classes.push("handbook-cell-edge-right");
    return Decoration.node(pos, pos + node.nodeSize, {class: classes.join(" ")});
  });
}

function rowMatches(row: Node, query: string) {
  return row.textContent.toLowerCase().includes(query);
}

function filterDecorations(state: EditorState, filters: TableFilter[]) {
  const decorations: Decoration[] = [];
  for (const {pos, query} of filters) {
    const table = state.doc.nodeAt(pos);
    if (!table || table.type.name !== "table") continue;
    const needle = query.trim().toLowerCase();
    if (!needle) continue;
    table.forEach((row, offset, index) => {
      if (index === 0 || rowMatches(row, needle)) return;
      const start = pos + 1 + offset;
      decorations.push(Decoration.node(start, start + row.nodeSize, {class: "handbook-row-filtered"}));
    });
  }
  return decorations;
}

function tablePositions(doc: Node) {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      positions.push(pos);
      return false;
    }
    return true;
  });
  return positions;
}

/** The heading directly above a table is its title. */
function titleBefore(doc: Node, tablePos: number) {
  const before = doc.resolve(tablePos).nodeBefore;
  return before && before.type.name === "heading" ? before : null;
}

function tableAround($pos: {depth: number; node: (depth: number) => Node; before: (depth: number) => number; start: (depth: number) => number}) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === "table") {
      return {node, pos: $pos.before(depth), start: $pos.start(depth)};
    }
  }
  return null;
}

function isCellEmpty(cell: Node) {
  if (cell.textContent.trim() !== "") return false;
  if (cell.childCount === 0) return true;
  return cell.childCount === 1 && cell.firstChild?.type.name === "paragraph" && cell.firstChild.childCount === 0;
}

function handleTableKey(ctx: Ctx, view: EditorView, event: KeyboardEvent) {
  const {state} = view;
  const commands = ctx.get(commandsCtx);

  if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    if (!(state.selection instanceof TextSelection)) return false;
    const $table = tableAround(state.selection.$head);
    if (!$table) return false;
    if (goToNextCell(1)(state)) return false;
    event.preventDefault();
    commands.call(addRowAfterCommand.key);
    commands.call(goToNextTableCellCommand.key);
    return true;
  }

  if (event.key === "Backspace" || event.key === "Delete") {
    const {selection} = state;
    if (!(selection instanceof CellSelection)) return false;
    const $table = tableAround(selection.$anchorCell);
    if (!$table) return false;
    let empty = true;
    selection.forEachCell((cell) => {
      if (!isCellEmpty(cell)) empty = false;
    });
    if (!empty) return false;
    const map = TableMap.get($table.node);
    const anchor = map.findCell(selection.$anchorCell.pos - $table.start);
    const head = map.findCell(selection.$headCell.pos - $table.start);
    const top = Math.min(anchor.top, head.top);
    const bottom = Math.max(anchor.bottom, head.bottom);
    const rows = bottom - top;
    const cols = Math.max(anchor.right, head.right) - Math.min(anchor.left, head.left);
    const wholeTable = selection.isRowSelection() && selection.isColSelection();
    if (!wholeTable) {
      if (selection.isRowSelection() && (top === 0 || rows >= map.height - 1)) return false;
      if (selection.isColSelection() && cols >= map.width) return false;
      if (!selection.isRowSelection() && !selection.isColSelection()) return false;
    }
    event.preventDefault();
    commands.call(deleteSelectedCellsCommand.key);
    return true;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const {selection} = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $table = tableAround(selection.$head);
    if (!$table) return false;
    const down = event.key === "ArrowDown";
    const map = TableMap.get($table.node);
    const rowIndex = selection.$head.index(selection.$head.depth - 3);
    if (down ? rowIndex !== map.height - 1 : rowIndex !== 0) return false;
    if (!view.endOfTextblock(down ? "down" : "up")) return false;
    const edge = down ? $table.pos + $table.node.nodeSize : $table.pos;
    const neighbour = down ? state.doc.nodeAt(edge) : state.doc.resolve(edge).nodeBefore;
    event.preventDefault();
    let tr = state.tr;
    if (neighbour && neighbour.isTextblock) {
      tr = tr.setSelection(Selection.near(tr.doc.resolve(edge), down ? 1 : -1));
    } else {
      const paragraph = state.schema.nodes.paragraph.create();
      tr = tr.insert(edge, paragraph);
      tr = tr.setSelection(TextSelection.create(tr.doc, edge + 1));
    }
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  return false;
}

function glyph(IconComponent: PhosphorIcon, size = 18) {
  return <IconComponent weight="duotone" size={size} aria-hidden />;
}

function tableAt(view: EditorView, tablePos: number) {
  const node = view.state.doc.nodeAt(tablePos);
  return node && node.type.name === "table" ? node : null;
}

function elementAt(view: EditorView, pos: number) {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
}

function cellPos(table: Node, tablePos: number, row: number, col: number) {
  return tablePos + 1 + TableMap.get(table).positionAt(row, col, table);
}

function cellNode(view: EditorView, pos: number) {
  return view.state.doc.nodeAt(pos);
}

function linePositions(table: Node, tablePos: number, axis: Axis, index: number) {
  const map = TableMap.get(table);
  const count = axis === "col" ? map.height : map.width;
  const positions: number[] = [];
  for (let other = 0; other < count; other += 1) {
    positions.push(
      cellPos(table, tablePos, axis === "col" ? other : index, axis === "col" ? index : other),
    );
  }
  return positions;
}

function isLineEmpty(view: EditorView, table: Node, tablePos: number, axis: Axis, index: number) {
  return linePositions(table, tablePos, axis, index).every((pos) => {
    const cell = cellNode(view, pos);
    return cell ? isCellEmpty(cell) : true;
  });
}

function locate(view: EditorView, x: number, y: number): Hover | null {
  const found = view.posAtCoords({left: x, top: y});
  if (!found) return null;
  const $pos = view.state.doc.resolve(found.pos);
  let tableDepth = -1;
  let cellDepth = -1;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === "table_cell" || name === "table_header") cellDepth = depth;
    if (name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0 || cellDepth < 0) return null;
  const table = $pos.node(tableDepth);
  const map = TableMap.get(table);
  const rect = map.findCell($pos.before(cellDepth) - $pos.start(tableDepth));
  return {tablePos: $pos.before(tableDepth), row: rect.top, col: rect.left};
}

function lineRects(view: EditorView, table: Node, tablePos: number, axis: Axis) {
  const map = TableMap.get(table);
  const count = axis === "col" ? map.width : map.height;
  const rects: DOMRect[] = [];
  for (let index = 0; index < count; index += 1) {
    const pos = cellPos(table, tablePos, axis === "col" ? 0 : index, axis === "col" ? index : 0);
    const element = elementAt(view, pos);
    if (!element) {
      rects.push(new DOMRect());
      continue;
    }
    const target = axis === "col" ? element : (element.closest("tr") ?? element);
    rects.push(target.getBoundingClientRect());
  }
  return rects;
}

function targetIndex(rects: DOMRect[], axis: Axis, x: number, y: number, min: number) {
  const point = axis === "col" ? x : y;
  for (let index = min; index < rects.length; index += 1) {
    const rect = rects[index];
    const start = axis === "col" ? rect.left : rect.top;
    const end = axis === "col" ? rect.right : rect.bottom;
    if (point >= start && point <= end) return index;
  }
  const first = rects[min];
  if (first && point < (axis === "col" ? first.left : first.top)) return min;
  return rects.length - 1;
}

/** Clones the cells of one row or column into a floating table used as the drag preview. */
function buildGhost(view: EditorView, table: Node, tablePos: number, axis: Axis, index: number) {
  const ghost = document.createElement("table");
  ghost.className = "handbook-table-ghost-table";
  const body = document.createElement("tbody");
  ghost.appendChild(body);
  const positions = linePositions(table, tablePos, axis, index);
  const row = axis === "row" ? document.createElement("tr") : null;
  if (row) body.appendChild(row);
  for (const pos of positions) {
    const element = elementAt(view, pos);
    if (!element) continue;
    const clone = element.cloneNode(true) as HTMLElement;
    clone.classList.remove("handbook-cell-hidden", "handbook-cell-selected");
    clone.removeAttribute("contenteditable");
    const rect = element.getBoundingClientRect();
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    if (row) {
      row.appendChild(clone);
    } else {
      const line = document.createElement("tr");
      line.appendChild(clone);
      body.appendChild(line);
    }
  }
  return ghost;
}

function relative(rect: DOMRect, origin: DOMRect): Box {
  return {
    top: rect.top - origin.top,
    left: rect.left - origin.left,
    width: rect.width,
    height: rect.height,
  };
}

function within(rect: DOMRect, x: number, y: number, margin: number) {
  return (
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin
  );
}

/** Persistent header above each table: title affordance, row count, and the row filter. */
function TableToolbar({
  box,
  hasTitle,
  query,
  rows,
  visible,
  onFilter,
  onAddTitle,
}: {
  box: Box;
  hasTitle: boolean;
  query: string;
  rows: number;
  visible: number;
  onFilter: (query: string) => void;
  onAddTitle: () => void;
}) {
  const count =
    visible === rows ? `${rows} ${rows === 1 ? "row" : "rows"}` : `${visible} of ${rows} rows`;
  return (
    <Toolbar
      label="Table"
      size="sm"
      dividers={["bottom"]}
      className="handbook-table-toolbar"
      style={{top: box.top - TOOLBAR_ROOM, left: box.left, width: box.width}}
      startContent={
        <HStack gap={2} vAlign="center">
          {hasTitle ? null : (
            <Button
              label="Add title"
              variant="ghost"
              size="sm"
              icon={glyph(TextT, 14)}
              onClick={onAddTitle}
            />
          )}
          <Text type="supporting" color="secondary">
            {count}
          </Text>
        </HStack>
      }
      endContent={
        <TextInput
          label="Filter rows"
          isLabelHidden
          size="sm"
          value={query}
          onChange={onFilter}
          placeholder="Filter rows"
          startIcon={glyph(FunnelSimple, 14)}
          hasClear
          autoComplete="off"
          width={200}
        />
      }
    />
  );
}

export function DocumentTableControls({
  get,
  host,
  tick,
  onMenuOpenChange,
}: {
  get: EditorGetter;
  host: HTMLDivElement | null;
  tick: number;
  onMenuOpenChange: (open: boolean) => void;
}) {
  void tick;
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<Axis | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, setResized] = useState(0);
  const menuRef = useRef<Axis | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const busyRef = useRef(false);
  const draggedRef = useRef(false);

  const withView = <T,>(fn: (view: EditorView, ctx: Ctx) => T): T | undefined => {
    let result: T | undefined;
    get()?.action((ctx) => {
      result = fn(ctx.get(editorViewCtx), ctx);
    });
    return result;
  };

  useEffect(() => {
    if (!host) return;
    const onMove = (event: globalThis.PointerEvent) => {
      if (dragRef.current || busyRef.current || menuRef.current) return;
      const target = event.target;
      if (target instanceof Element && host.contains(target)) return;
      withView((view) => {
        const next = locate(view, event.clientX, event.clientY);
        setHover((prev) => {
          if (next) {
            return prev &&
              prev.tablePos === next.tablePos &&
              prev.row === next.row &&
              prev.col === next.col
              ? prev
              : next;
          }
          if (!prev) return prev;
          const table = elementAt(view, prev.tablePos);
          if (
            table &&
            within(table.getBoundingClientRect(), event.clientX, event.clientY, HOVER_MARGIN)
          ) {
            return prev;
          }
          return null;
        });
      });
    };
    const onResize = () => setResized((value) => value + 1);
    document.addEventListener("pointermove", onMove);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, get]);

  useEffect(() => {
    menuRef.current = menu;
    onMenuOpenChange(menu !== null);
  }, [menu, onMenuOpenChange]);

  if (!host) return null;

  const setFilter = (pos: number, query: string) => {
    withView((view) => {
      const meta: TableMeta = {filter: {pos, query}};
      view.dispatch(view.state.tr.setMeta(TABLE_KEY, meta).setMeta("addToHistory", false));
    });
  };

  const addTitle = (pos: number) => {
    withView((view) => {
      const heading = view.state.schema.nodes.heading.create({level: 3});
      const tr = view.state.tr.insert(pos, heading);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
      view.dispatch(tr);
      view.focus();
    });
  };

  const toolbars =
    withView((view) => {
      const origin = host.getBoundingClientRect();
      const {filters} = tableStateOf(view.state);
      return tablePositions(view.state.doc).flatMap((pos) => {
        const table = tableAt(view, pos);
        const element = elementAt(view, pos);
        if (!table || !element) return [];
        const query = filters.find((filter) => filter.pos === pos)?.query ?? "";
        const needle = query.trim().toLowerCase();
        const rows = table.childCount - 1;
        let visible = rows;
        if (needle) {
          visible = 0;
          table.forEach((row, _offset, index) => {
            if (index > 0 && rowMatches(row, needle)) visible += 1;
          });
        }
        return [
          <TableToolbar
            key={pos}
            box={relative(element.getBoundingClientRect(), origin)}
            hasTitle={titleBefore(view.state.doc, pos) !== null}
            query={query}
            rows={rows}
            visible={visible}
            onFilter={(next) => setFilter(pos, next)}
            onAddTitle={() => addTitle(pos)}
          />,
        ];
      });
    }) ?? [];

  if (!hover) return createPortal(<>{toolbars}</>, host);

  const geometry = withView((view) => {
    const table = tableAt(view, hover.tablePos);
    if (!table) return null;
    const map = TableMap.get(table);
    const row = Math.min(hover.row, map.height - 1);
    const col = Math.min(hover.col, map.width - 1);
    const tableElement = elementAt(view, hover.tablePos);
    const cellElement = elementAt(view, cellPos(table, hover.tablePos, row, col));
    const headElement = elementAt(view, cellPos(table, hover.tablePos, 0, col));
    const rowElement = cellElement?.closest("tr") ?? null;
    if (!tableElement || !cellElement || !headElement || !rowElement) return null;
    const origin = host.getBoundingClientRect();
    return {
      table,
      row,
      col,
      width: map.width,
      height: map.height,
      tableBox: relative(tableElement.getBoundingClientRect(), origin),
      columnBox: relative(headElement.getBoundingClientRect(), origin),
      rowBox: relative(rowElement.getBoundingClientRect(), origin),
      origin,
    };
  });
  if (!geometry) return createPortal(<>{toolbars}</>, host);

  const {row, col, width, height, tableBox, columnBox, rowBox, origin} = geometry;
  const insideTable = hover.tablePos + 1;

  const call = (fn: (ctx: Ctx, view: EditorView) => void) => {
    withView((view, ctx) => fn(ctx, view));
  };

  const selectLine = (ctx: Ctx, axis: Axis, index: number) => {
    ctx
      .get(commandsCtx)
      .call(axis === "col" ? selectColCommand.key : selectRowCommand.key, {index, pos: insideTable});
  };

  const insert = (axis: Axis, index: number, side: "before" | "after") => {
    call((ctx) => {
      selectLine(ctx, axis, index);
      const command =
        axis === "col"
          ? side === "before"
            ? addColBeforeCommand
            : addColAfterCommand
          : side === "before"
            ? addRowBeforeCommand
            : addRowAfterCommand;
      ctx.get(commandsCtx).call(command.key);
    });
  };

  const copyLine = (view: EditorView, axis: Axis, from: number, to: number) => {
    const table = tableAt(view, hover.tablePos);
    if (!table) return;
    const sources = linePositions(table, hover.tablePos, axis, from);
    const targets = linePositions(table, hover.tablePos, axis, to);
    const pairs = sources.map((source, index) => ({source, target: targets[index]}));
    pairs.sort((a, b) => b.target - a.target);
    let tr = view.state.tr;
    for (const {source, target} of pairs) {
      const sourceCell = cellNode(view, source);
      const targetCell = cellNode(view, target);
      if (!sourceCell || !targetCell) continue;
      tr = tr.setNodeMarkup(target, undefined, {
        ...targetCell.attrs,
        alignment: sourceCell.attrs.alignment,
      });
      tr = tr.replaceWith(target + 1, target + targetCell.nodeSize - 1, sourceCell.content);
    }
    if (tr.docChanged) view.dispatch(tr);
  };

  const duplicate = (axis: Axis, index: number) => {
    call((ctx, view) => {
      selectLine(ctx, axis, index);
      ctx.get(commandsCtx).call(axis === "col" ? addColAfterCommand.key : addRowAfterCommand.key);
      copyLine(view, axis, index, index + 1);
    });
  };

  const clear = (axis: Axis, index: number) => {
    call((_ctx, view) => {
      const table = tableAt(view, hover.tablePos);
      if (!table) return;
      const positions = linePositions(table, hover.tablePos, axis, index).sort((a, b) => b - a);
      let tr = view.state.tr;
      for (const pos of positions) {
        const cell = cellNode(view, pos);
        if (!cell) continue;
        tr = tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, view.state.schema.nodes.paragraph.create());
      }
      if (tr.docChanged) view.dispatch(tr);
    });
  };

  const remove = (axis: Axis, index: number) => {
    call((ctx, view) => {
      const table = tableAt(view, hover.tablePos);
      if (!table) return;
      const map = TableMap.get(table);
      if (axis === "col" && map.width <= 1) return;
      if (axis === "row" && (index === 0 || map.height <= 2)) return;
      selectLine(ctx, axis, index);
      ctx.get(commandsCtx).call(deleteSelectedCellsCommand.key);
    });
  };

  const align = (index: number, direction: "left" | "center" | "right") => {
    call((ctx) => {
      selectLine(ctx, "col", index);
      ctx.get(commandsCtx).call(setAlignCommand.key, direction);
    });
  };

  const addLast = (axis: Axis) => {
    call((ctx, view) => {
      const table = tableAt(view, hover.tablePos);
      if (!table) return;
      const map = TableMap.get(table);
      selectLine(ctx, axis, (axis === "col" ? map.width : map.height) - 1);
      ctx.get(commandsCtx).call(axis === "col" ? addColAfterCommand.key : addRowAfterCommand.key);
    });
  };

  const removeLastIfEmpty = (axis: Axis) => {
    let removed = false;
    call((ctx, view) => {
      const table = tableAt(view, hover.tablePos);
      if (!table) return;
      const map = TableMap.get(table);
      const last = (axis === "col" ? map.width : map.height) - 1;
      if (axis === "col" && map.width <= 1) return;
      if (axis === "row" && map.height <= 2) return;
      if (!isLineEmpty(view, table, hover.tablePos, axis, last)) return;
      selectLine(ctx, axis, last);
      ctx.get(commandsCtx).call(deleteSelectedCellsCommand.key);
      removed = true;
    });
    return removed;
  };

  const setHidden = (positions: number[] | null) => {
    withView((view) => {
      const meta: TableMeta = {hidden: positions};
      view.dispatch(view.state.tr.setMeta(TABLE_KEY, meta).setMeta("addToHistory", false));
    });
  };

  const keepFocus = (event: MouseEvent) => {
    event.preventDefault();
  };

  const openMenu = (axis: Axis) => (open: boolean) => {
    if (open && draggedRef.current) return;
    if (open) call((ctx) => selectLine(ctx, axis, axis === "col" ? col : row));
    setMenu(open ? axis : null);
  };

  /** Press on a `+` bar: a click adds one line, a drag adds or removes one line per step. */
  const pressAdd = (axes: Axis[], event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    busyRef.current = true;
    const start = {x: event.clientX, y: event.clientY};
    const last = {x: event.clientX, y: event.clientY};
    let dragging = false;
    host.classList.add("handbook-table-controls-busy");
    const onMove = (move: globalThis.PointerEvent) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      if (!dragging && dx * dx + dy * dy < DRAG_THRESHOLD) return;
      dragging = true;
      for (const axis of axes) {
        const point = axis === "col" ? move.clientX : move.clientY;
        const previous = axis === "col" ? last.x : last.y;
        const delta = point - previous;
        if (Math.abs(delta) < ADD_STEP[axis]) continue;
        if (delta > 0) {
          addLast(axis);
        } else if (!removeLastIfEmpty(axis)) {
          continue;
        }
        if (axis === "col") last.x = point;
        else last.y = point;
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      host.classList.remove("handbook-table-controls-busy");
      busyRef.current = false;
      if (!dragging) {
        for (const axis of axes) addLast(axis);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /** Press on a six-dot handle: a click opens the menu, a drag reorders the line. */
  const press = (axis: Axis, from: number, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    if (axis === "row" && from === 0) return;
    const start = {x: event.clientX, y: event.clientY};
    const grab = axis === "col" ? event.clientX - (origin.left + columnBox.left) : event.clientY - (origin.top + rowBox.top);
    let dragging = false;
    const onMove = (move: globalThis.PointerEvent) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      if (!dragging && dx * dx + dy * dy < DRAG_THRESHOLD) return;
      move.preventDefault();
      const next = withView((view) => {
        const table = tableAt(view, hover.tablePos);
        if (!table) return null;
        let ghost = dragRef.current?.ghost;
        if (!dragging) {
          dragging = true;
          draggedRef.current = true;
          ghost = buildGhost(view, table, hover.tablePos, axis, from);
          setHidden(linePositions(table, hover.tablePos, axis, from));
        }
        if (!ghost) return null;
        const rects = lineRects(view, table, hover.tablePos, axis);
        const to = targetIndex(rects, axis, move.clientX, move.clientY, axis === "row" ? 1 : 0);
        return {axis, from, to, ghost, offset: grab, pointer: axis === "col" ? move.clientX : move.clientY};
      });
      if (!next) return;
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const result = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (result) {
        setHidden(null);
        if (result.to !== result.from) {
          call((ctx) => {
            ctx
              .get(commandsCtx)
              .call(result.axis === "col" ? moveColCommand.key : moveRowCommand.key, {
                from: result.from,
                to: result.to,
                pos: insideTable,
              });
          });
          setHover((prev) => (prev ? {...prev, [result.axis]: result.to} : prev));
        }
      }
      window.setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const columnItems: DropdownMenuOption[] = [
    {id: "left", label: "Insert left", icon: glyph(ColumnsPlusLeft), onClick: () => insert("col", col, "before")},
    {id: "right", label: "Insert right", icon: glyph(ColumnsPlusRight), onClick: () => insert("col", col, "after")},
    {id: "duplicate", label: "Duplicate", icon: glyph(Copy), onClick: () => duplicate("col", col)},
    {id: "clear", label: "Clear contents", icon: glyph(Eraser), onClick: () => clear("col", col)},
    {type: "divider"},
    {id: "align-left", label: "Align left", icon: glyph(TextAlignLeft), onClick: () => align(col, "left")},
    {id: "align-center", label: "Align center", icon: glyph(TextAlignCenter), onClick: () => align(col, "center")},
    {id: "align-right", label: "Align right", icon: glyph(TextAlignRight), onClick: () => align(col, "right")},
    {type: "divider"},
    {
      id: "delete",
      label: "Delete",
      icon: glyph(Trash),
      variant: "destructive",
      isDisabled: width <= 1,
      onClick: () => remove("col", col),
    },
  ];

  const rowItems: DropdownMenuOption[] = [
    {
      id: "above",
      label: "Insert above",
      icon: glyph(RowsPlusTop),
      isDisabled: row === 0,
      onClick: () => insert("row", row, "before"),
    },
    {id: "below", label: "Insert below", icon: glyph(RowsPlusBottom), onClick: () => insert("row", row, "after")},
    {id: "duplicate", label: "Duplicate", icon: glyph(Copy), onClick: () => duplicate("row", row)},
    {id: "clear", label: "Clear contents", icon: glyph(Eraser), onClick: () => clear("row", row)},
    {type: "divider"},
    {
      id: "delete",
      label: "Delete",
      icon: glyph(Trash),
      variant: "destructive",
      isDisabled: row === 0 || height <= 2,
      onClick: () => remove("row", row),
    },
  ];

  const dropLine = (() => {
    if (!drag || drag.from === drag.to) return null;
    return withView((view) => {
      const table = tableAt(view, hover.tablePos);
      if (!table) return null;
      const rect = lineRects(view, table, hover.tablePos, drag.axis)[drag.to];
      if (!rect) return null;
      const box = relative(rect, origin);
      if (drag.axis === "col") {
        const left = drag.to > drag.from ? box.left + box.width : box.left;
        return {top: tableBox.top, left: left - 1, width: 2, height: tableBox.height};
      }
      const top = drag.to > drag.from ? box.top + box.height : box.top;
      return {top: top - 1, left: tableBox.left, width: tableBox.width, height: 2};
    });
  })();

  const ghostBox = (() => {
    if (!drag) return null;
    if (drag.axis === "col") {
      const left = drag.pointer - origin.left - drag.offset;
      return {top: tableBox.top, left: Math.max(tableBox.left, Math.min(left, tableBox.left + tableBox.width - columnBox.width))};
    }
    const top = drag.pointer - origin.top - drag.offset;
    return {top: Math.max(tableBox.top, Math.min(top, tableBox.top + tableBox.height - rowBox.height)), left: tableBox.left};
  })();

  const mountGhost = (element: HTMLElement | null) => {
    // Callback ref: the ghost table is a detached DOM clone, so it is attached here.
    if (!element || !drag) return;
    if (element.firstChild !== drag.ghost) element.replaceChildren(drag.ghost);
  };

  return createPortal(
    <>
      {toolbars}
      <HStack
        className="handbook-table-handle handbook-table-handle-col"
        style={{top: tableBox.top + 4, left: columnBox.left + columnBox.width / 2}}
        onPointerDown={(event) => press("col", col, event)}
      >
        <DropdownMenu
          isMenuOpen={menu === "col"}
          onOpenChange={openMenu("col")}
          button={{
            label: "Column actions",
            isIconOnly: true,
            icon: glyph(DotsSix, 16),
            variant: "ghost",
            size: "sm",
            tooltip: "Column actions",
          }}
          items={columnItems}
          placement="below"
          alignment="start"
          menuWidth={220}
        />
      </HStack>
      <HStack
        className="handbook-table-handle handbook-table-handle-row"
        style={{top: rowBox.top + rowBox.height / 2, left: tableBox.left - 4}}
        onPointerDown={(event) => press("row", row, event)}
      >
        <DropdownMenu
          isMenuOpen={menu === "row"}
          onOpenChange={openMenu("row")}
          button={{
            label: "Row actions",
            isIconOnly: true,
            icon: glyph(DotsSixVertical, 16),
            variant: "ghost",
            size: "sm",
            tooltip: "Row actions",
          }}
          items={rowItems}
          placement="below"
          alignment="start"
          menuWidth={220}
        />
      </HStack>
      <VStack
        className="handbook-table-add handbook-table-add-col"
        style={{top: tableBox.top, left: tableBox.left + tableBox.width + 2, height: tableBox.height}}
        justify="center"
        align="center"
        onPointerDown={(event) => pressAdd(["col"], event)}
      >
        <IconButton
          label="Add column"
          tooltip="Add column. Drag to add or remove several"
          variant="ghost"
          size="sm"
          icon={glyph(Plus, 14)}
          onMouseDown={keepFocus}
        />
      </VStack>
      <HStack
        className="handbook-table-add handbook-table-add-row"
        style={{top: tableBox.top + tableBox.height + 2, left: tableBox.left, width: tableBox.width}}
        justify="center"
        align="center"
        onPointerDown={(event) => pressAdd(["row"], event)}
      >
        <IconButton
          label="Add row"
          tooltip="Add row. Drag to add or remove several"
          variant="ghost"
          size="sm"
          icon={glyph(Plus, 14)}
          onMouseDown={keepFocus}
        />
      </HStack>
      <HStack
        className="handbook-table-add handbook-table-add-corner"
        style={{top: tableBox.top + tableBox.height + 2, left: tableBox.left + tableBox.width + 2}}
        onPointerDown={(event) => pressAdd(["col", "row"], event)}
      >
        <IconButton
          label="Add row and column"
          tooltip="Add row and column. Drag to add or remove several"
          variant="ghost"
          size="sm"
          icon={glyph(Plus, 14)}
          onMouseDown={keepFocus}
        />
      </HStack>
      {dropLine ? <VStack className="handbook-table-drop" style={dropLine} /> : null}
      {ghostBox ? <VStack ref={mountGhost} className="handbook-table-ghost" style={ghostBox} /> : null}
    </>,
    host,
  );
}
