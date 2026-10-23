/**
 * Column floors of the analytics tables. Astryx equal-width columns stop at a
 * 60px floor, so at 375px the project names wrapped one letter per line and
 * the headers truncated. A named floor per kind of column lets the table's
 * own scroll region take over when the floors no longer fit.
 */
import { proportional } from "@astryxdesign/core/Table";

/** A name or title: room for a short word before it wraps. */
export const NAME_COLUMN = proportional(2, { minWidth: 128 });
/** A project, status or date cell. */
export const TEXT_COLUMN = proportional(1, { minWidth: 96 });
/** A count under a header such as "Completed" (98px with its padding at the table's text size). */
export const COUNT_COLUMN = proportional(1, { minWidth: 100 });
/** The completion bar and its "8 of 40" label. */
export const BAR_COLUMN = proportional(1, { minWidth: 136 });
