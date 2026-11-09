/**
 * Virtual windows (decisions 135-138): thresholds, overscan and the size estimates the first window is computed
 * from. Shared by the list, table, board and gantt layouts and by the Playwright specs.
 */

/** Strictly more loaded rows than this turns windowing on (decision 135). */
export const VIRTUAL_LIST_MIN = 30;
/** Data rows plus grouped header rows. */
export const VIRTUAL_TABLE_MIN = 30;
export const VIRTUAL_GANTT_MIN = 40;
/** Loaded cards per board column; swimlane cells are never windowed. */
export const VIRTUAL_BOARD_MIN = 8;

export type VirtualKind = "list" | "table" | "board" | "gantt";

/** Rows rendered beyond each edge of the measured window (live). */
export const OVERSCAN: Record<VirtualKind, number> = { list: 4, table: 4, board: 2, gantt: 6 };

/** Rows rendered after the estimated first viewport, on the server and before the scroller is measured. */
export const INITIAL_OVERSCAN: Record<VirtualKind, number> = { list: 2, table: 2, board: 1, gantt: 4 };

/*
 * Row sizes and the fixed parts above each container, in CSS px. Measured in the 2026-10-29 refresh at 1280 px in
 * Latte and Frappé, on the small fixture and the 10 000-item one. They only place the first window (server render
 * and hydration); after the first paint every rendered row is measured and the measured sizes replace them.
 */
export const ESTIMATE: Record<VirtualKind, number> = { list: 44, table: 37, board: 136, gantt: 32 };
/** The board's cards stack is `VStack gap={2}`. */
export const BOARD_GAP_ESTIMATE = 8;
export const START = {
  listPadding: 8,
  groupBand: 40,
  groupGap: 8,
  listFooter: 44,
  quickAdd: 36,
  tableHead: 30,
  boardBodyPadding: 8,
  ganttBody: 0,
} as const;

/** The scroller height assumed until it is measured (server render and hydration). */
export const INITIAL_VIEWPORT = 768;
/** The same for a board column body. */
export const INITIAL_BOARD_BODY = 528;
