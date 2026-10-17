/**
 * Rows of the page "…" menu (docs/drafts/p6-plan.md "PageRowMenu"). Pure, so
 * the list row and the page header render the same actions.
 *
 * ASSUMPTION: DropdownMenuOption has no `disabledMessage`. A disabled reason
 * is the row's `description` (the MoreMenu leaf-row shape the field guide
 * names). Locked pages refuse name, body, labels, move and delete; those
 * rows say "Unlock the page first". Archive, access, duplicate, unlock and
 * copy stay available on a lock. An archived page is read-only apart from
 * restore and delete.
 */
import type { PageSummary } from "@/lib/tessera/types";

export type PageMenuAction =
  | "open"
  | "add-subpage"
  | "duplicate"
  | "move-up"
  | "move-down"
  | "move"
  | "lock"
  | "unlock"
  | "make-private"
  | "make-public"
  | "copy-link"
  | "archive"
  | "restore"
  | "delete";

export type PageMenuEntry = {
  id: PageMenuAction;
  label: string;
  isDisabled?: boolean;
  description?: string;
  variant?: "destructive";
  dividerBefore?: boolean;
};

export const UNLOCK_FIRST = "Unlock the page first";
export const ARCHIVED_PAGE = "This page is archived";

/** Writes a lock refuses, plus adding a child under the locked page. */
const LOCKED_CONTENT: ReadonlySet<PageMenuAction> = new Set(["add-subpage", "move-up", "move-down", "move", "delete"]);

/** Everything an archived page refuses except restore, delete, open, duplicate and copy. */
const ARCHIVED_BLOCKED: ReadonlySet<PageMenuAction> = new Set([
  "add-subpage",
  "move-up",
  "move-down",
  "move",
  "lock",
  "unlock",
  "make-private",
  "make-public",
]);

export type PageMenuInput = {
  page: Pick<PageSummary, "is_locked" | "access" | "archived_at">;
  includeOpen: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

function blockReason(id: PageMenuAction, page: PageMenuInput["page"]): string | undefined {
  if (page.archived_at !== null && id !== "delete" && ARCHIVED_BLOCKED.has(id)) return ARCHIVED_PAGE;
  if (page.is_locked && LOCKED_CONTENT.has(id)) return UNLOCK_FIRST;
  return undefined;
}

function entry(id: PageMenuAction, label: string, page: PageMenuInput["page"], extra?: { disabled?: boolean; variant?: "destructive"; dividerBefore?: boolean }): PageMenuEntry {
  const reason = blockReason(id, page);
  return {
    id,
    label,
    isDisabled: reason !== undefined || extra?.disabled === true,
    description: reason,
    variant: extra?.variant,
    dividerBefore: extra?.dividerBefore,
  };
}

/** The menu rows for one page. The header omits Open. */
export function pageMenuEntries(input: PageMenuInput): PageMenuEntry[] {
  const { page, includeOpen, canMoveUp, canMoveDown } = input;
  const archived = page.archived_at !== null;
  const rows: PageMenuEntry[] = [];
  if (includeOpen) rows.push(entry("open", "Open", page));
  rows.push(
    entry("add-subpage", "Add sub-page", page),
    entry("duplicate", "Duplicate", page),
    entry("move-up", "Move up", page, { disabled: !canMoveUp }),
    entry("move-down", "Move down", page, { disabled: !canMoveDown }),
    entry("move", "Move…", page),
    page.is_locked ? entry("unlock", "Unlock", page) : entry("lock", "Lock", page),
    page.access === "public" ? entry("make-private", "Make private", page) : entry("make-public", "Make public", page),
    entry("copy-link", "Copy link", page),
  );
  if (archived) {
    rows.push(entry("restore", "Restore", page, { dividerBefore: true }), entry("delete", "Delete…", page, { variant: "destructive" }));
  } else {
    rows.push(entry("archive", "Archive", page, { dividerBefore: true }));
  }
  return rows;
}
