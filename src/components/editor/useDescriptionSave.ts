"use client";

/**
 * Save queue of the description editor (docs/contracts/editor.md, "Save
 * queue"; docs/PLAN.md §7): 400 ms debounce after the last change, one
 * request in flight, compare-and-set on `expected_description_version`,
 * CONFLICT and "updated elsewhere" handling for the host's Banner, a
 * `pagehide` beacon so a reload within the debounce still persists, and a
 * flush on unmount. A beacon sent while a save is in flight carries that
 * save's text as `if_current_md`: the save usually lands first, and the
 * route then builds on it instead of answering CONFLICT and dropping what
 * was typed after the save started. Lane D2's `DescriptionEditor` composes this hook with
 * `MarkdownEditor` and the Banner.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useToast } from "@astryxdesign/core/Toast";
import { refreshAction } from "@/app/actions/shell";
import { updateWorkItemDescriptionAction } from "@/app/actions/work-items";
import type { MarkdownEditorHandle } from "./MarkdownEditor";

/** Delay between the last change and the save. */
export const DESCRIPTION_SAVE_DELAY_MS = 400;

export type DescriptionSaveStatus = "clean" | "dirty" | "saving" | "conflict" | "error";

export type DescriptionSaveState = {
  status: DescriptionSaveStatus;
  /** description_version of the text the editor currently builds on. */
  version: number;
  /** Set on CONFLICT from the action or the beacon route. */
  conflict: { current_version: number } | null;
  /** Server text that arrived while the editor had local edits or focus. */
  theirs: { version: number; text: string } | null;
  /** Serialised form reported by onLossyParse; cleared by "Edit anyway" or source editing. */
  lossy: string | null;
  error: string | null;
};

export type UseDescriptionSaveInput = {
  workItemId: string;
  /** Props from the host: refreshed by refresh() after writes and by ChangesPoller. */
  serverText: string;
  serverVersion: number;
  editor: RefObject<MarkdownEditorHandle | null>;
};

export type UseDescriptionSaveResult = {
  state: DescriptionSaveState;
  /** Marks dirty and (re)starts the 400 ms timer. */
  onChange: (markdown: string) => void;
  /** Sends now (blur, mod+s, Escape, unmount, item switch). */
  flush: () => Promise<void>;
  /** Resends with expected_description_version = conflict.current_version (or theirs.version). */
  keepMine: () => Promise<void>;
  /** editor.setMarkdown(theirs.text), version = theirs.version, clean; refreshes first when theirs is unknown. */
  loadTheirs: () => void;
  /** lossy → null, the editor is editable again. */
  editAnyway: () => void;
  /** editor.setMode("source"), lossy → null. */
  viewSource: () => void;
  /** Pass as MarkdownEditor's onLossyParse: records the serialised form and blocks saves until "Edit anyway" or "View source". */
  onLossyParse: (serialised: string) => void;
};

/** Mutable mirror of the state for the event handlers (timer, listeners, cleanup). */
type Internal = {
  workItemId: string;
  version: number;
  /** Text the editor currently holds. */
  latest: string;
  /** Text last written to or adopted from the server. */
  lastSaved: string;
  /** Text of the request in flight, if any. */
  inFlight: string | null;
  /** A change arrived during the request: send again when it returns. */
  resendAfter: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  status: DescriptionSaveStatus;
  conflict: { current_version: number } | null;
  theirs: { version: number; text: string } | null;
  lossy: string | null;
  /** "Load theirs" was clicked before the server text arrived. */
  awaitingTheirs: boolean;
  /** Set on pagehide: the beacon carries the text, no Server Action may race it. Cleared when the page is restored. */
  unloading: boolean;
  /** Text the last pagehide beacon carried, if any. */
  beaconText: string | null;
};

/**
 * sessionStorage key of the last pagehide beacon. A reload sends the beacon and
 * the page request at the same moment, so the new page may render the text from
 * before the beacon landed; the marker lets the next mount notice and refresh.
 */
export const BEACON_MARKER_KEY = "tessera.descriptionBeacon.v1";
/** A marker older than this belongs to an earlier visit and is ignored. */
export const BEACON_MARKER_MAX_AGE_MS = 10_000;
/** Refreshes after mounting on a page rendered before the beacon landed. */
export const BEACON_REFRESH_DELAYS_MS: readonly number[] = [300, 1500];

/**
 * What the last beacon carried: the item, the text, the highest version the
 * server can hold without that text (the version it built on, plus one when
 * a save was in flight and may land first), and when (ms since epoch).
 */
export type BeaconMarker = { workItemId: string; text: string; version: number; at: number };

/** Body of the pagehide beacon (POST /api/work-items/<id>/description). */
export type BeaconBody = { description_md: string; expected_description_version: number; if_current_md?: string };

/**
 * The beacon for unsaved `latest` built on `version`. With a save of
 * `inFlight` still running, the route may find that save already stored one
 * version later; `if_current_md` lets it build on it. The marker's version
 * then counts that save too, so the next page refreshes until it has the
 * beacon's text.
 */
export function beaconPayload(input: { latest: string; version: number; inFlight: string | null }): { body: BeaconBody; markerVersion: number } {
  const body: BeaconBody = { description_md: input.latest, expected_description_version: input.version };
  if (input.inFlight === null) return { body, markerVersion: input.version };
  return { body: { ...body, if_current_md: input.inFlight }, markerVersion: input.version + 1 };
}

/** The stored marker, or null when it is missing or malformed. */
export function parseBeaconMarker(raw: string | null): BeaconMarker | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { workItemId, text, version, at } = value as Record<string, unknown>;
    if (typeof workItemId !== "string" || typeof text !== "string" || typeof version !== "number" || typeof at !== "number") return null;
    return { workItemId, text, version, at };
  } catch {
    return null;
  }
}

/**
 * True when the page for `workItemId` was rendered from server state older than
 * the beacon sent just before it: same item, recent, the server version not past
 * the version the beacon built on, and the server text not yet the beacon's.
 */
export function renderedBeforeBeacon(
  marker: BeaconMarker | null,
  page: { workItemId: string; serverText: string; serverVersion: number },
  now: number,
): boolean {
  if (marker === null || marker.workItemId !== page.workItemId) return false;
  if (now - marker.at > BEACON_MARKER_MAX_AGE_MS || now < marker.at) return false;
  return page.serverVersion <= marker.version && page.serverText !== marker.text;
}

function readBeaconMarker(): BeaconMarker | null {
  try {
    return parseBeaconMarker(window.sessionStorage.getItem(BEACON_MARKER_KEY));
  } catch {
    return null;
  }
}

function clearBeaconMarker(): void {
  try {
    window.sessionStorage.removeItem(BEACON_MARKER_KEY);
  } catch {
    // Storage unavailable: nothing was stored.
  }
}

function writeBeaconMarker(marker: BeaconMarker): void {
  try {
    window.sessionStorage.setItem(BEACON_MARKER_KEY, JSON.stringify(marker));
  } catch {
    // Storage unavailable (private mode, quota): the page may then show the pre-beacon text until the next refresh.
  }
}

function conflictVersion(details: unknown): number | null {
  if (typeof details !== "object" || details === null) return null;
  const current = (details as { current_version?: unknown }).current_version;
  return typeof current === "number" ? current : null;
}

export function useDescriptionSave(input: UseDescriptionSaveInput): UseDescriptionSaveResult {
  const { workItemId, serverText, serverVersion } = input;
  const toast = useToast();
  // The host's handle ref, mirrored into a local ref so the callbacks below stay stable.
  const handleRef = useRef(input.editor);
  useEffect(() => {
    handleRef.current = input.editor;
  });
  const getHandle = useCallback(() => handleRef.current.current, []);
  const [state, setState] = useState<DescriptionSaveState>({
    status: "clean",
    version: serverVersion,
    conflict: null,
    theirs: null,
    lossy: null,
    error: null,
  });
  const internal = useRef<Internal>({
    workItemId,
    version: serverVersion,
    latest: serverText,
    lastSaved: serverText,
    inFlight: null,
    resendAfter: false,
    timer: null,
    status: "clean",
    conflict: null,
    theirs: null,
    lossy: null,
    awaitingTheirs: false,
    unloading: false,
    beaconText: null,
  });

  const update = useCallback((patch: Partial<DescriptionSaveState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  const clearTimer = useCallback(() => {
    const m = internal.current;
    if (m.timer !== null) {
      clearTimeout(m.timer);
      m.timer = null;
    }
  }, []);

  // The timer, the listeners and the resend after a save call the latest `send` without re-registering.
  const sendRef = useRef<(expected?: number) => Promise<void>>(async () => {});

  /**
   * Sends the latest text. Without `expected` the save is held while a
   * conflict or a newer server text waits for the user's choice; `keepMine`
   * passes the version to build on and forces the send.
   */
  const send = useCallback(
    async (expected?: number): Promise<void> => {
      const m = internal.current;
      if (m.lossy !== null || m.unloading) return;
      if (expected === undefined && (m.conflict !== null || m.theirs !== null)) return;
      if (m.inFlight !== null) {
        m.resendAfter = true;
        return;
      }
      const text = m.latest;
      if (expected === undefined && text === m.lastSaved) {
        if (m.status === "dirty") {
          m.status = "clean";
          update({ status: "clean" });
        }
        return;
      }
      const version = expected ?? m.version;
      m.inFlight = text;
      m.status = "saving";
      update({ status: "saving", error: null });
      const result = await updateWorkItemDescriptionAction({
        work_item_id: m.workItemId,
        description_md: text,
        expected_description_version: version,
      });
      m.inFlight = null;
      if (result.ok) {
        m.version = result.data.description_version;
        m.lastSaved = text;
        m.conflict = null;
        if (m.theirs !== null && m.theirs.version <= m.version) m.theirs = null;
        const more = m.latest !== text || m.resendAfter;
        m.resendAfter = false;
        m.status = more ? "dirty" : "clean";
        update({ status: m.status, version: m.version, conflict: null, theirs: m.theirs, error: null });
        if (more) void sendRef.current();
        return;
      }
      m.resendAfter = false;
      if (result.code === "CONFLICT") {
        const current = conflictVersion(result.details);
        m.conflict = { current_version: current ?? version };
        m.status = "conflict";
        update({ status: "conflict", conflict: m.conflict });
        // Without the current version in the details, fetch the server state so "Load theirs" has it.
        if (current === null) void refreshAction();
        return;
      }
      m.status = "error";
      update({ status: "error", error: result.message });
      toast({ type: "error", body: `Could not save the description: ${result.message}` });
    },
    [toast, update],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onChange = useCallback(
    (markdown: string) => {
      const m = internal.current;
      m.latest = markdown;
      if (m.lossy !== null) {
        // Source editing (the only way to edit while lossy) accepts the rewrite.
        m.lossy = null;
        update({ lossy: null });
      }
      if (m.status !== "conflict" && m.status !== "saving") {
        m.status = "dirty";
        update({ status: "dirty" });
      }
      clearTimer();
      m.timer = setTimeout(() => {
        m.timer = null;
        void sendRef.current();
      }, DESCRIPTION_SAVE_DELAY_MS);
    },
    [clearTimer, update],
  );

  const flush = useCallback(async () => {
    clearTimer();
    await sendRef.current();
  }, [clearTimer]);

  const keepMine = useCallback(async () => {
    const m = internal.current;
    const expected = m.conflict?.current_version ?? m.theirs?.version ?? m.version;
    m.conflict = null;
    m.theirs = null;
    m.version = expected;
    update({ conflict: null, theirs: null, version: expected });
    clearTimer();
    await sendRef.current(expected);
  }, [clearTimer, update]);

  const applyServer = useCallback(
    (text: string, version: number) => {
      const m = internal.current;
      getHandle()?.setMarkdown(text);
      m.version = version;
      m.latest = text;
      m.lastSaved = text;
      m.conflict = null;
      m.theirs = null;
      m.awaitingTheirs = false;
      m.status = "clean";
      update({ status: "clean", version, conflict: null, theirs: null, error: null });
    },
    [getHandle, update],
  );

  const loadTheirs = useCallback(() => {
    const m = internal.current;
    clearTimer();
    if (m.theirs !== null) {
      applyServer(m.theirs.text, m.theirs.version);
      return;
    }
    m.awaitingTheirs = true;
    void refreshAction();
  }, [applyServer, clearTimer]);

  const onLossyParse = useCallback(
    (serialised: string) => {
      internal.current.lossy = serialised;
      update({ lossy: serialised });
    },
    [update],
  );

  const editAnyway = useCallback(() => {
    internal.current.lossy = null;
    update({ lossy: null });
  }, [update]);

  const viewSource = useCallback(() => {
    getHandle()?.setMode("source");
    internal.current.lossy = null;
    update({ lossy: null });
  }, [getHandle, update]);

  // Server props: silent accept while clean and unfocused, otherwise "theirs" for the Banner.
  useEffect(() => {
    const m = internal.current;
    m.workItemId = workItemId;
    if (serverVersion <= m.version) {
      if (m.theirs !== null && m.theirs.version <= m.version) {
        m.theirs = null;
        update({ theirs: null });
      }
      return;
    }
    // Our own save landing through refresh() before its promise resolved.
    if (m.inFlight !== null && serverText === m.inFlight) return;
    // The server already holds our text (a pagehide beacon, or the same edit made elsewhere): adopt its version, nothing to choose.
    if (m.inFlight === null && serverText === m.latest) {
      clearTimer();
      m.version = serverVersion;
      m.lastSaved = serverText;
      m.conflict = null;
      m.theirs = null;
      m.awaitingTheirs = false;
      m.status = "clean";
      update({ status: "clean", version: serverVersion, conflict: null, theirs: null, error: null });
      return;
    }
    const handle = getHandle();
    const busy =
      m.status === "dirty" ||
      m.status === "saving" ||
      m.status === "conflict" ||
      m.status === "error" ||
      (handle?.isFocused() ?? false) ||
      (handle?.hasLocalEdits() ?? false);
    if (m.awaitingTheirs || !busy) {
      applyServer(serverText, serverVersion);
      return;
    }
    m.theirs = { version: serverVersion, text: serverText };
    update({ theirs: m.theirs });
  }, [applyServer, clearTimer, getHandle, serverText, serverVersion, update, workItemId]);

  // Leaving the page: the beacon outlives the document and no Server Action is sent after it (they would race on the same
  // version). A tab that is only hidden stays alive, so it saves through the action and learns the new version.
  useEffect(() => {
    const onPageHide = () => {
      const m = internal.current;
      m.unloading = true;
      clearTimer();
      if (m.lossy !== null || m.conflict !== null || m.theirs !== null) return;
      if (m.latest === m.lastSaved || typeof navigator.sendBeacon !== "function") return;
      // A save still in flight: its text rides along so the route can build on it once it has landed.
      const { body, markerVersion } = beaconPayload({ latest: m.latest, version: m.version, inFlight: m.inFlight });
      const queued = navigator.sendBeacon(`/api/work-items/${m.workItemId}/description`, new Blob([JSON.stringify(body)], { type: "application/json" }));
      if (!queued) return;
      m.beaconText = m.latest;
      writeBeaconMarker({ workItemId: m.workItemId, text: m.latest, version: markerVersion, at: Date.now() });
    };
    const onPageShow = (event: PageTransitionEvent) => {
      const m = internal.current;
      m.unloading = false;
      // Restored from the back/forward cache after a beacon: fetch the server state so its version is adopted.
      if (event.persisted && m.beaconText !== null) {
        m.beaconText = null;
        void refreshAction();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clearTimer, flush]);

  // Mounted on a page rendered before the previous page's beacon landed (reload inside the debounce): refresh until the
  // server text arrives; the server-prop rule above then applies it (clean, unfocused) or offers it as "theirs".
  // The marker stays until it is settled (Strict Mode mounts twice) and expires after BEACON_MARKER_MAX_AGE_MS anyway.
  useEffect(() => {
    const m = internal.current;
    const marker = readBeaconMarker();
    if (marker === null || marker.workItemId !== m.workItemId) return;
    if (!renderedBeforeBeacon(marker, { workItemId: m.workItemId, serverText: m.lastSaved, serverVersion: m.version }, Date.now())) {
      clearBeaconMarker();
      return;
    }
    const last = BEACON_REFRESH_DELAYS_MS.length - 1;
    const timers = BEACON_REFRESH_DELAYS_MS.map((delay, index) =>
      setTimeout(() => {
        const now = internal.current;
        const caughtUp = now.version > marker.version || now.lastSaved === marker.text;
        if (caughtUp || index === last) clearBeaconMarker();
        if (!caughtUp) void refreshAction();
      }, delay),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  // Unmount (peek closed, item switched) and a route hidden by <Activity>: a pending save goes out through flush(). The
  // action call outlives the component, and send() records the new version, so a route shown again builds on it.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  return { state, onChange, flush, keepMine, loadTheirs, editAnyway, viewSource, onLossyParse };
}
