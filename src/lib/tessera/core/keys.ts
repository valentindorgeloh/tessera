/**
 * Human keys and name normalisation (decisions 3 and 7). Client-safe.
 * `WEB-12` is computed from `project.identifier` and `work_item.sequence_id`,
 * never stored.
 */
import { WORK_ITEM_KEY_PATTERN } from "../schemas";

export type ParsedKey = { identifier: string; sequenceId: number };

export function formatKey(identifier: string, sequenceId: number): string {
  return `${identifier}-${sequenceId}`;
}

/** Accepts any case and surrounding whitespace ("web-12 " parses as WEB-12); null when it is not a key. */
export function parseKey(raw: string): ParsedKey | null {
  const m = WORK_ITEM_KEY_PATTERN.exec(raw.trim().toUpperCase());
  if (!m) return null;
  return { identifier: m[1], sequenceId: Number(m[2]) };
}

/** Trim and upper-case a project identifier before validating it. */
export function normalizeIdentifier(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Case-insensitive, whitespace-collapsed form of a name; stored in `name_key` for the unique index. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
