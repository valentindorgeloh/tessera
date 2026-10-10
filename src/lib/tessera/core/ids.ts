/** UUIDv7 ids for every entity table (decision 2): time-ordered, so inserts stay index-friendly. */
import { v7 } from "uuid";

export function newId(): string {
  return v7();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True for any RFC 9562 UUID string (seeded actor ids are fixed, not v7). */
export function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}
