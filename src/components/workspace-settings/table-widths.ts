/**
 * Column floors of the workspace settings tables (backups, exports, webhook
 * deliveries). Astryx gives equal columns a 60px floor, so at 375px a file name
 * broke one letter per line, header labels truncated and a row's actions sat
 * half outside the scroll region. The one text column that carries a long value
 * keeps a flexible floor and takes the free width; every other column is a fixed
 * pixel width sized to its header and its widest cell (cell padding included).
 * When the floors no longer fit, the table's own scroll region takes over, as in
 * the analytics tables (analytics/table-widths.ts).
 */
import { pixel, proportional } from "@astryxdesign/core/Table";

/** A file or export name: wraps at its hyphens and spaces into two lines, not one letter per line. */
export const FILE_NAME_COLUMN = proportional(1, { minWidth: 216 });
/** An export title: wraps at spaces. */
export const TITLE_COLUMN = proportional(1, { minWidth: 136 });
/** A code identifier such as `work_item.created`. */
export const CODE_COLUMN = proportional(1, { minWidth: 152 });
/** A token or a status with its dot: "Pre-restore", "Automatic", "Running". */
export const TOKEN_COLUMN = pixel(104);
/** A short number or a short header: "Rows", "Size", "Format", "Check". */
export const SHORT_COLUMN = pixel(72);
/** A numeric column whose header never wraps (header cells truncate): "Attempts", "Response". */
export const WIDE_NUMBER_COLUMN = pixel(96);
/** A relative time ("3 months ago"). */
export const TIME_COLUMN = pixel(112);
/** A row's two icon buttons: 28px each, their gap and the cell padding. */
export const ACTIONS_COLUMN = pixel(88);
/** One icon button in a row. */
export const ACTION_COLUMN = pixel(56);

/*
 * Folded layouts: when the table's container is narrower than its full floors
 * (exports 584px, webhook deliveries 688px) the secondary columns move into a
 * second line of the first cell, and these floors keep every remaining column,
 * the row's actions included, inside a 325px phone column.
 */
/** An export title when the table is folded. */
export const TITLE_COLUMN_FOLDED = proportional(1, { minWidth: 112 });
/** A webhook event when the table is folded: whole at 325px, else it breaks at a dot. */
export const CODE_COLUMN_FOLDED = proportional(1, { minWidth: 136 });
/** Widest container (px) at which the exports table needs its folded layout: TITLE 136 + 72 + 72 + 104 + 112 + 88. */
export const EXPORTS_FULL_WIDTH = 584;
/** Widest container (px) at which the delivery table needs its folded layout: CODE 152 + 72 + 104 + 96 + 96 + 112 + 56. */
export const DELIVERIES_FULL_WIDTH = 688;
