"use client";

/**
 * Peek host (docs/contracts/ui.md "Routes and modes"): wraps the work items
 * screen and shows the item named by `?peek=<id>` next to it. `side` (the
 * default) is a resizable end panel of a nested Layout, 360–720 px wide,
 * holding an inset card (4px inside the content panel's border, 12px corners
 * that follow the panel's 16px ones) that scrolls the detail under its pinned
 * header; `modal` is a
 * Dialog over the list; both remember width and mode in
 * localStorage (./peek-prefs.ts). Open and close only change the `peek`
 * search param (./peek-url.ts keeps `q`), so a reload restores the panel.
 * Escape closes the side panel; the Dialog closes itself on Escape. An item
 * that has loaded counts as a visit to its full page in the recents
 * (src/components/shell/recents-store.ts), on every list that mounts the
 * peek (the project's, a cycle's, a module's, the archived work items); a
 * peek that shows "not found" is never recorded. The list stays mounted in
 * the same tree position whether or not the panel is open, so an open or
 * close never resets its state or focus.
 *
 * One mount point: the detail renders once, through a portal, into a DOM node
 * this host owns. The side panel and the modal each hold a slot that adopts
 * that node, so switching between them (from the header, or when the stored
 * mode loads after hydration) moves DOM and keeps every React state: the
 * editor with its unsaved text and undo history, a save in flight, the title
 * being edited. The portal starts after hydration (portals have no server
 * render); until then the slot shows a skeleton. Focus stays on the control
 * that switched the mode.
 *
 * Close goes Back when the list pushed the entry being closed (./peek-history.ts),
 * so opening and closing the peek leaves no duplicate history entry. While
 * mounted, the host is counted in ./peek-hosts.ts, which Power K reads before
 * it opens a work item hit as a peek.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog } from "@/components/shell/dialogs";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { LayerDepthProvider } from "@astryxdesign/core/Layer";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { recordVisit } from "@/components/shell/recents-store";
import { IdSchema } from "@/lib/tessera/schemas";
import { workItemPath } from "./DetailHeader";
import { WorkItemDetail } from "./WorkItemDetail";
import type { DetailHost, WorkItemDetailData } from "./types";
import { clearPeekPush, movePeekPush, readPeekPush, stampPeekPush } from "./peek-history";
import { registerPeekHost } from "./peek-hosts";
import { PEEK_MAX_WIDTH, PEEK_MIN_WIDTH, hasNoResizeRange, loadPeekPrefs, savePeekPrefs, usePeekPrefs } from "./peek-prefs";
import { useIsPanelCover } from "./peek-cover";
import { closesWithBack, currentHref, mountsPeek, peekHref } from "./peek-url";

/** The item the URL names; `data: null` when it is unknown, deleted or belongs to another project. */
export type PeekData = { id: string; data: WorkItemDetailData | null };

export type PeekHostProps = {
  projectId: string;
  /** null when the URL carries no `peek`. */
  peek: PeekData | null;
  children: ReactNode;
};

/**
 * The panel for an id this project cannot show. An item of another project
 * (a cross-project `work:` link opened from a description) still has a home:
 * the global page `/work-items/<id>` loads it with its own project, or shows
 * the not-found screen when the id is unknown.
 */
function PeekNotFound({ id, onClose }: { id: string; onClose: () => void }) {
  const isWellFormed = IdSchema.safeParse(id).success;
  return (
    <VStack padding={6}>
      <EmptyState
        isCompact
        title="Work item not found"
        description="It is not in this project, it was deleted, or the link is wrong."
        actions={
          <>
            {isWellFormed ? <Button label="Open full page" variant="secondary" size="sm" href={`/work-items/${id}`} /> : null}
            <Button label="Close" variant={isWellFormed ? "ghost" : "secondary"} size="sm" onClick={onClose} />
          </>
        }
      />
    </VStack>
  );
}

/**
 * Where the detail shows: adopts the host's mount node as its only DOM child
 * (React renders no children here, so it never touches the adopted node).
 * Without a node yet (server render, hydration) it shows a skeleton.
 */
function PeekSlot({ node }: { node: HTMLElement | null }) {
  const adopt = useCallback(
    (element: HTMLDivElement | null) => {
      if (element !== null && node !== null && node.parentNode !== element) element.appendChild(node);
    },
    [node],
  );
  if (node === null) {
    return (
      <VStack gap={3} padding={4}>
        <Skeleton width="40%" height={20} />
        <Skeleton width="80%" height={32} index={1} />
        <Skeleton width="100%" height={160} index={2} />
      </VStack>
    );
  }
  return <VStack ref={adopt} className="tessera-peek-slot" />;
}

/**
 * True while the container leaves the side panel no range to resize in. The
 * panel never outgrows its container (detail.css: on a phone its stored
 * 360–720px width is wider than the screen, so it covers the list), and a
 * resize handle there has nothing to move. A panel merely as wide as the
 * container still has a range (a tablet, a drag to the maximum): the handle
 * stays so it can be dragged back. The returned ref goes on an element inside
 * the panel; the observer re-checks whenever the container changes size.
 */
export function useIsPanelCapped(): [boolean, (element: HTMLElement | null) => void | (() => void)] {
  const [isCapped, setCapped] = useState(false);
  const watch = useCallback((element: HTMLElement | null) => {
    const panel = element?.closest<HTMLElement>(".tessera-peek-panel");
    const container = panel?.parentElement;
    if (!panel || !container) return;
    const update = () => setCapped(hasNoResizeRange(container.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return [isCapped, watch];
}

const subscribeNothing = () => () => {};

/** False during the server render and hydration, true afterwards. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

export function PeekHost({ projectId, peek, children }: PeekHostProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefs = usePeekPrefs();
  const isOpen = peek !== null;
  const isModal = prefs.mode === "modal";
  const isClient = useIsClient();
  // The detail's mount node: a plain DOM container (not layout), created once on the client and moved between slots.
  const [mountNode] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    const node = document.createElement("div");
    node.className = "tessera-peek-node";
    return node;
  });
  const slotNode = isClient ? mountNode : null;
  const here = currentHref(pathname, searchParams);

  useEffect(() => {
    loadPeekPrefs();
  }, []);

  // Power K opens a work item of this project as a peek only while a host is mounted (./peek-hosts.ts).
  useEffect(() => registerPeekHost(projectId), [projectId]);

  // A loaded item counts as a visit to its full page; recording the page again first keeps the item ahead of it.
  // Only on the project's own list routes (`mountsPeek`: work items, a cycle, a module, archived work items).
  const visitPath = peek?.data ? workItemPath(peek.data.item) : null;
  const isListRoute = mountsPeek(pathname, projectId);
  useEffect(() => {
    if (visitPath === null || !isListRoute) return;
    recordVisit(pathname);
    recordVisit(visitPath);
  }, [isListRoute, pathname, visitPath]);

  // The list's push has landed once its URL is current: record the history length it produced.
  useEffect(() => {
    if (isOpen) stampPeekPush(here, window.history.length);
  }, [here, isOpen]);

  const close = () => {
    const target = peekHref(pathname, searchParams, null);
    const push = readPeekPush();
    clearPeekPush();
    if (closesWithBack(push, here, target, window.history.length)) router.back();
    else router.replace(target, { scroll: false });
  };
  const openItem = (id: string) => {
    const next = peekHref(pathname, searchParams, id);
    movePeekPush(here, next);
    router.replace(next, { scroll: false });
  };
  // The control that had focus when the mode changed (the "Open as" menu trigger): the Dialog's own focus handling runs while the
  // detail is between slots, so focus would otherwise land on the page body.
  const refocus = useRef<HTMLElement | null>(null);
  const changeHost = (host: DetailHost) => {
    if (!peek) return;
    if (host === "page") {
      router.push(`/projects/${projectId}/work-items/${peek.id}`);
      return;
    }
    const active = document.activeElement;
    refocus.current = active instanceof HTMLElement && mountNode !== null && mountNode.contains(active) ? active : null;
    savePeekPrefs({ mode: host === "modal" ? "modal" : "side" });
  };
  useEffect(() => {
    const target = refocus.current;
    refocus.current = null;
    if (target === null) return;
    const frame = window.requestAnimationFrame(() => {
      if (target.isConnected) target.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isModal]);

  // The Dialog owns Escape while it is open (its layer stack prevents the default), so the hotkey serves the side panel.
  useHotkeys([{ keys: "escape", onPress: close, allowInInputs: true, isDisabled: !isOpen || isModal }]);

  const panel = useResizable({
    defaultSize: prefs.width,
    minSize: PEEK_MIN_WIDTH,
    maxSize: PEEK_MAX_WIDTH,
    direction: "horizontal",
    onSizeChange: (size) => savePeekPrefs({ width: size }),
  });

  // `defaultSize` is read once, before storage is; apply the stored width when it arrives.
  const appliedStoredWidth = useRef(false);
  const { isLoaded, width } = prefs;
  const { resize } = panel;
  useEffect(() => {
    if (!isLoaded || appliedStoredWidth.current) return;
    appliedStoredWidth.current = true;
    resize(width);
  }, [isLoaded, resize, width]);

  const [isPanelCapped, watchPanel] = useIsPanelCapped();
  // A container too narrow for list plus panel (a tablet with the sidebar open): the panel covers the list (./peek-cover.ts).
  const [isPanelCover, watchCover] = useIsPanelCover();
  const watchPanelAndCover = useCallback(
    (element: HTMLElement | null) => {
      const stopCapped = watchPanel(element);
      const stopCover = watchCover(element);
      return () => {
        if (typeof stopCapped === "function") stopCapped();
        if (typeof stopCover === "function") stopCover();
      };
    },
    [watchPanel, watchCover],
  );

  const detail = peek ? (
    peek.data ? (
      <WorkItemDetail key={peek.id} data={peek.data} host={isModal ? "modal" : "peek"} onClose={close} onHostChange={changeHost} onOpenItem={openItem} />
    ) : (
      <PeekNotFound key={peek.id} id={peek.id} onClose={close} />
    )
  ) : null;

  const sidePanel =
    isOpen && !isModal ? (
      <>
        {isPanelCapped || isPanelCover ? null : <ResizeHandle resizable={panel.props} direction="horizontal" isReversed hasDivider={false} label="Resize the work item panel" />}
        <LayoutPanel resizable={panel.props} hasDivider={false} padding={1} isScrollable={false} label="Work item" role="complementary" className={isPanelCover ? "tessera-peek-panel tessera-peek-panel--cover" : "tessera-peek-panel"}>
          <Card ref={watchPanelAndCover} padding={0} height="100%" elevation="low" className="tessera-peek-card">
            <PeekSlot node={slotNode} />
          </Card>
        </LayoutPanel>
      </>
    ) : undefined;

  return (
    <>
      <Layout
        height="fill"
        content={
          <LayoutContent padding={0} isScrollable>
            {children}
          </LayoutContent>
        }
        end={sidePanel}
      />
      {isOpen && isModal ? (
        <Dialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close();
          }}
          variant="standard"
          width={760}
          maxHeight="85dvh"
          purpose="form"
          padding={0}
          aria-label="Work item"
        >
          <PeekSlot node={slotNode} />
        </Dialog>
      ) : null}
      {/* Same tree position in both modes; the layer depth matches what the Dialog gives its own children. */}
      {detail && slotNode ? createPortal(<LayerDepthProvider>{detail}</LayerDepthProvider>, slotNode) : null}
    </>
  );
}
