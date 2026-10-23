"use client";

/**
 * Page body (docs/drafts/p6-plan.md "PageBodyEditor"): the shared Markdown
 * editor plus the same conflict and lossy-parse banners as the work item
 * description.
 *
 * ASSUMPTION: `useDescriptionSave` takes a work item id and calls
 * `updateWorkItemDescriptionAction`, and its beacon posts to the work item
 * description route. Reusing it would mean editing `src/components/editor`,
 * which this lane does not own. The queue below is the same 400 ms debounce,
 * one request in flight and compare-and-set, calling `updatePageBodyAction`.
 * A reload inside the debounce can drop the last keystrokes: the page body
 * beacon route is not part of this lane, so there is no `pagehide` beacon.
 *
 * ASSUMPTION: `entityRoute` still returns null for `page:` links. Those open
 * `/pages/<id>` (a project page redirects from that route). A `work:` link
 * opens `/browse/<key>` because a page screen does not mount a peek host.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { refreshAction } from "@/app/actions/shell";
import { updatePageBodyAction } from "@/app/actions/pages";
import { DESCRIPTION_SAVE_DELAY_MS, MarkdownEditor, entityRoute, type EntityLink, type MarkdownEditorHandle } from "@/components/editor";

export type PageBodyEditorProps = {
  pageId: string;
  /** Markdown the route last loaded. */
  text: string;
  /** description_version of `text`. */
  version: number;
  readOnly?: boolean;
  /** Scope of the `#` work-item search. Null on a wiki page. */
  projectId?: string | null;
  mentionActors?: readonly { id: string; name: string }[];
  /** DOM root for the page Outline (headings live under the editor). */
  bodyRef?: RefObject<HTMLDivElement | null>;
};

type SaveStatus = "clean" | "dirty" | "saving" | "conflict" | "error";

type SaveState = {
  status: SaveStatus;
  version: number;
  conflict: { current_version: number } | null;
  theirs: { version: number; text: string } | null;
  lossy: string | null;
  error: string | null;
};

type Internal = {
  pageId: string;
  version: number;
  latest: string;
  lastSaved: string;
  inFlight: string | null;
  resendAfter: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  status: SaveStatus;
  conflict: { current_version: number } | null;
  theirs: { version: number; text: string } | null;
  lossy: string | null;
  awaitingTheirs: boolean;
};

const STATUS_TEXT: Record<SaveStatus, string> = {
  clean: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Not saved",
  error: "Not saved",
};

function conflictVersion(details: unknown): number | null {
  if (typeof details !== "object" || details === null) return null;
  const current = (details as { current_version?: unknown }).current_version;
  return typeof current === "number" ? current : null;
}

export function PageBodyEditor({ pageId, text, version, readOnly = false, projectId = null, mentionActors = [], bodyRef }: PageBodyEditorProps) {
  const toast = useToast();
  const router = useRouter();
  const editor = useRef<MarkdownEditorHandle | null>(null);
  const [state, setState] = useState<SaveState>({
    status: "clean",
    version,
    conflict: null,
    theirs: null,
    lossy: null,
    error: null,
  });
  const internal = useRef<Internal>({
    pageId,
    version,
    latest: text,
    lastSaved: text,
    inFlight: null,
    resendAfter: false,
    timer: null,
    status: "clean",
    conflict: null,
    theirs: null,
    lossy: null,
    awaitingTheirs: false,
  });

  const update = useCallback((patch: Partial<SaveState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  const clearTimer = useCallback(() => {
    const current = internal.current;
    if (current.timer !== null) {
      clearTimeout(current.timer);
      current.timer = null;
    }
  }, []);

  const sendRef = useRef<(expected?: number) => Promise<void>>(async () => {});

  const send = useCallback(
    async (expected?: number): Promise<void> => {
      const current = internal.current;
      if (readOnly || current.lossy !== null) return;
      if (expected === undefined && (current.conflict !== null || current.theirs !== null)) return;
      if (current.inFlight !== null) {
        current.resendAfter = true;
        return;
      }
      const body = current.latest;
      if (expected === undefined && body === current.lastSaved) {
        if (current.status === "dirty") {
          current.status = "clean";
          update({ status: "clean" });
        }
        return;
      }
      const base = expected ?? current.version;
      current.inFlight = body;
      current.status = "saving";
      update({ status: "saving", error: null });
      const result = await updatePageBodyAction({
        page_id: current.pageId,
        description_md: body,
        expected_description_version: base,
      });
      current.inFlight = null;
      if (result.ok) {
        current.version = result.data.description_version;
        current.lastSaved = body;
        current.conflict = null;
        if (current.theirs !== null && current.theirs.version <= current.version) current.theirs = null;
        const more = current.latest !== body || current.resendAfter;
        current.resendAfter = false;
        current.status = more ? "dirty" : "clean";
        update({ status: current.status, version: current.version, conflict: null, theirs: current.theirs, error: null });
        if (more) void sendRef.current();
        return;
      }
      current.resendAfter = false;
      if (result.code === "CONFLICT") {
        const currentVersion = conflictVersion(result.details);
        current.conflict = { current_version: currentVersion ?? base };
        current.status = "conflict";
        update({ status: "conflict", conflict: current.conflict });
        if (currentVersion === null) void refreshAction();
        return;
      }
      current.status = "error";
      update({ status: "error", error: result.message });
      toast({ type: "error", body: `Could not save the page: ${result.message}` });
    },
    [readOnly, toast, update],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onChange = useCallback(
    (markdown: string) => {
      if (readOnly) return;
      const current = internal.current;
      current.latest = markdown;
      if (current.lossy !== null) {
        current.lossy = null;
        update({ lossy: null });
      }
      if (current.status !== "conflict" && current.status !== "saving") {
        current.status = "dirty";
        update({ status: "dirty" });
      }
      clearTimer();
      current.timer = setTimeout(() => {
        current.timer = null;
        void sendRef.current();
      }, DESCRIPTION_SAVE_DELAY_MS);
    },
    [clearTimer, readOnly, update],
  );

  const flush = useCallback(async () => {
    clearTimer();
    await sendRef.current();
  }, [clearTimer]);

  const keepMine = useCallback(async () => {
    const current = internal.current;
    const expected = current.conflict?.current_version ?? current.theirs?.version ?? current.version;
    current.conflict = null;
    current.theirs = null;
    current.version = expected;
    update({ conflict: null, theirs: null, version: expected });
    clearTimer();
    await sendRef.current(expected);
  }, [clearTimer, update]);

  const applyServer = useCallback(
    (nextText: string, nextVersion: number) => {
      const current = internal.current;
      editor.current?.setMarkdown(nextText);
      current.version = nextVersion;
      current.latest = nextText;
      current.lastSaved = nextText;
      current.conflict = null;
      current.theirs = null;
      current.awaitingTheirs = false;
      current.status = "clean";
      update({ status: "clean", version: nextVersion, conflict: null, theirs: null, error: null });
    },
    [update],
  );

  const loadTheirs = useCallback(() => {
    const current = internal.current;
    clearTimer();
    if (current.theirs !== null) {
      applyServer(current.theirs.text, current.theirs.version);
      return;
    }
    current.awaitingTheirs = true;
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
    editor.current?.setMode("source");
    internal.current.lossy = null;
    update({ lossy: null });
  }, [update]);

  useEffect(() => {
    const current = internal.current;
    current.pageId = pageId;
    if (version <= current.version) {
      if (current.theirs !== null && current.theirs.version <= current.version) {
        current.theirs = null;
        update({ theirs: null });
      }
      return;
    }
    if (current.inFlight !== null && text === current.inFlight) return;
    if (current.inFlight === null && text === current.latest) {
      clearTimer();
      current.version = version;
      current.lastSaved = text;
      current.conflict = null;
      current.theirs = null;
      current.awaitingTheirs = false;
      current.status = "clean";
      update({ status: "clean", version, conflict: null, theirs: null, error: null });
      return;
    }
    const handle = editor.current;
    const busy =
      current.status === "dirty" ||
      current.status === "saving" ||
      current.status === "conflict" ||
      current.status === "error" ||
      (handle?.isFocused() ?? false) ||
      (handle?.hasLocalEdits() ?? false);
    if (current.awaitingTheirs || !busy) {
      applyServer(text, version);
      return;
    }
    current.theirs = { version, text };
    update({ theirs: current.theirs });
  }, [applyServer, clearTimer, pageId, text, update, version]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void flush();
    };
  }, [flush]);

  const openEntity = (link: EntityLink) => {
    if (link.scheme === "work") {
      router.push(`/browse/${encodeURIComponent(link.ref)}`);
      return;
    }
    if (link.scheme === "page") {
      router.push(`/pages/${encodeURIComponent(link.ref)}`);
      return;
    }
    const route = entityRoute(link);
    if (route !== null) router.push(route);
  };

  const lossy = state.lossy;
  let banner = null;
  if (state.status === "conflict" || state.theirs !== null) {
    banner = (
      <Banner
        status="warning"
        title={state.status === "conflict" ? "Changed elsewhere" : "Updated elsewhere"}
        description="Someone else saved this page while you were editing."
        endContent={
          <HStack gap={1}>
            <Button variant="secondary" size="sm" label="Keep mine" onClick={() => void keepMine()} />
            <Button variant="ghost" size="sm" label="Load theirs" onClick={loadTheirs} />
          </HStack>
        }
      />
    );
  } else if (lossy !== null) {
    banner = (
      <Banner
        status="info"
        title="This page uses Markdown the editor would rewrite"
        description="Editing it here would change its formatting."
        endContent={
          <HStack gap={1}>
            <Button variant="secondary" size="sm" label="View source" onClick={viewSource} />
            <Button variant="ghost" size="sm" label="Edit anyway" onClick={editAnyway} />
          </HStack>
        }
      />
    );
  }

  return (
    <VStack ref={bodyRef} gap={2} className="tessera-page-body">
      {banner}
      <MarkdownEditor
        key={pageId}
        ref={editor}
        value={text}
        onChange={onChange}
        onFlush={() => void flush()}
        onLossyParse={onLossyParse}
        readOnly={readOnly || lossy !== null}
        placeholder="Write the page. Type / for blocks, # for work items, @ for people."
        mentionActors={mentionActors}
        projectId={projectId}
        pageId={pageId}
        onOpenEntity={openEntity}
      />
      <Text type="supporting" color="secondary" aria-live="polite">
        {readOnly ? "Read only" : STATUS_TEXT[state.status]}
      </Text>
    </VStack>
  );
}
