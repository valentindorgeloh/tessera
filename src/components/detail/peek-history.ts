/**
 * The history entry the work items list pushed to open the peek, kept in
 * sessionStorage (per tab, survives a reload) under `tessera.peekPush.v1`.
 * `WorkItemsScreen.onOpen` notes the push, `PeekHost` stamps the history
 * length once the URL changed, follows an in-place item switch and decides on
 * close whether Back lands where closing should (./peek-url.ts
 * `closesWithBack`). Every storage access is guarded: without storage the
 * peek closes with a replace, as before.
 */
import { parsePeekPush, type PeekPush } from "./peek-url";

export const PEEK_PUSH_KEY = "tessera.peekPush.v1";

/** Length placeholder until PeekHost sees the pushed URL. */
const PENDING_LENGTH = -1;

export function readPeekPush(): PeekPush | null {
  try {
    return parsePeekPush(window.sessionStorage.getItem(PEEK_PUSH_KEY));
  } catch {
    return null;
  }
}

export function writePeekPush(push: PeekPush): void {
  try {
    window.sessionStorage.setItem(PEEK_PUSH_KEY, JSON.stringify(push));
  } catch {
    // Storage unavailable: closing falls back to a replace.
  }
}

export function clearPeekPush(): void {
  try {
    window.sessionStorage.removeItem(PEEK_PUSH_KEY);
  } catch {
    // Nothing was stored.
  }
}

/** Called right before the list pushes `to` (the peek URL) from `from`. */
export function notePeekPush(from: string, to: string): void {
  writePeekPush({ from, to, length: PENDING_LENGTH });
}

/** Once the pushed URL is current, records the history length it produced. */
export function stampPeekPush(current: string, historyLength: number): void {
  const push = readPeekPush();
  if (push === null || push.length !== PENDING_LENGTH || push.to !== current) return;
  writePeekPush({ ...push, length: historyLength });
}

/** The peek switched item in place (a replace): the pushed entry now holds `next`. */
export function movePeekPush(current: string, next: string): void {
  const push = readPeekPush();
  if (push === null || push.to !== current) return;
  writePeekPush({ ...push, to: next });
}
