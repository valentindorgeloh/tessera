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
 *
 * Motion (docs/contracts/ui.md "Motion"): the side panel slides in from the end edge when the peek OPENS in a host that is
 * already mounted (`useEnterFlag`) and out when it closes (Escape, the header Close, the not-found Close). A panel that covers
 * the list (a narrow container, ./peek-cover.ts) fades in and out instead: a slide would show the squeezed list as a blank strip.
 * Nothing animates for a `?peek=` deep link, hydration, any mount with the peek already open, or the browser's Back and Forward
 * (a popstate): an open or an item change that follows one stays still, and a close that goes Back itself (`closesWithBack`) is
 * not counted as one. A close starts its navigation at once and runs the CSS exit meanwhile (`playExit`, 140 ms, held out until
 * the panel unmounts); the host keeps the leaving item on screen until the exit ends, so a Back that lands within a frame does not
 * cut it. The leaving panel is inert from the first frame of the exit until the URL drops the item or names another, so focus
 * cannot land in it, and a second close (Escape or a button) does nothing in that time. A hidden route or an unmount ends the exit
 * and never navigates again. The modal keeps the Astryx Dialog's own motion. Switching to another item while the peek is open
 * fades the shared mount node (`useAnimator`, 0.4 to 1). The nested Layout clips the slide on the x axis (detail.css), so the
 * project's scroller never gains width while the panel travels.
 *
 * The detail is a separate chunk (./peek-detail-lazy.tsx, decision 142): the
 * editor stays out of the list routes' first load. The chunk is fetched when
 * the browser is idle or on the first pointer or focus contact with a list
 * row, and at once when the URL already names a peek; a peek opened before it
 * arrives shows the same skeleton as the slot before its mount node exists.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog } from "@/components/shell/dialogs";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useAnimator, useHotkeys } from "@astryxdesign/core/hooks";
import { LayerDepthProvider } from "@astryxdesign/core/Layer";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { VStack } from "@astryxdesign/core/Stack";
import { EXITING_ATTRIBUTE, clearExit, ignoreCancelled, playExit } from "@/components/motion/play-exit";
import { useEnterFlag } from "@/components/motion/use-enter-flag";
import { recordVisit } from "@/components/shell/recents-store";
import { IdSchema } from "@/lib/tessera/schemas";
import { workItemPath } from "./DetailHeader";
import { PeekDetail, PeekSkeleton, preloadPeekDetail, schedulePreload } from "./peek-detail-lazy";
import type { DetailHost, WorkItemDetailData } from "./types";
import { clearPeekPush, movePeekPush, readPeekPush, stampPeekPush } from "./peek-history";
import { registerPeekHost } from "./peek-hosts";
import { PEEK_MAX_WIDTH, PEEK_MIN_WIDTH, hasNoResizeRange, loadPeekPrefs, savePeekPrefs, usePeekPrefs } from "./peek-prefs";
import { useCoverFocus, useIsPanelCover } from "./peek-cover";
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
 * A change that follows a popstate within this long is the browser's Back or Forward, the same window the page change fade uses
 * (src/components/shell/PageFade.tsx). Next restores a cached route within a frame and an uncached one after the fetch.
 * Known limit: an uncached Back or Forward that commits more than a second later animates like a click (accepted, as there).
 */
const POPSTATE_WINDOW_MS = 1000;

/** A popstate this soon after the panel's own `router.back()` is that Back, not the browser's. It arrives within a task or two. */
const OWN_BACK_WINDOW_MS = 1000;

/** The leaving panel: held out by `playExit` and inert, so focus and clicks stay out of it until the URL drops the item. */
function hold(panel: HTMLElement): void {
  panel.setAttribute("inert", "");
}

/** Takes the panel back: the exit marker and the inertness go, and it shows as it is. */
function release(panel: HTMLElement): void {
  clearExit(panel);
  panel.removeAttribute("inert");
}

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
  if (node === null) return <PeekSkeleton />;
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

  // The side panel's exit (see the header). `leaving` keeps the item on screen after the URL dropped it, until the exit ends.
  const panelRef = useRef<HTMLDivElement>(null);
  const exit = useRef<AbortController | null>(null);
  const [leaving, setLeaving] = useState<PeekData | null>(null);
  // What the panel shows: the URL's item, or the one that is leaving once the URL dropped it.
  const shown = peek ?? leaving;

  useEffect(() => {
    loadPeekPrefs();
  }, []);

  // An exit that is still running when the host goes (an unmount, a route Activity hides) is cancelled: nothing closes twice.
  useEffect(
    () => () => {
      exit.current?.abort();
    },
    [],
  );
  // Another item is named: a panel left held out by an exit that the URL never confirmed shows again, and takes focus and clicks.
  const shownId = peek?.id ?? null;
  useEffect(() => {
    if (shownId === null) return;
    exit.current?.abort();
    if (panelRef.current !== null) release(panelRef.current);
  }, [shownId]);

  // Switching items in place fades the shared mount node (the detail remounts under it, key={id}); a layout effect, so the
  // new item is first painted at the dip. Not on open or close, not on a refresh (the id is the same), and not on the
  // browser's Back or Forward, which restore an item instead of going to one (the page change fade reads a popstate the same way).
  const mountRef = useRef<HTMLElement | null>(mountNode);
  const fade = useAnimator(mountRef);
  const lastId = useRef(shownId);
  const poppedAt = useRef(Number.NEGATIVE_INFINITY);
  /** True from the moment a dip starts until the end of that task (a macrotask cannot run between two listeners of one event). */
  const dippedThisTask = useRef(false);
  useLayoutEffect(() => {
    const before = lastId.current;
    lastId.current = shownId;
    if (before === null || shownId === null || before === shownId) return;
    if (performance.now() - poppedAt.current < POPSTATE_WINDOW_MS) return;
    fade.set({ opacity: 0.4 });
    void fade.animate({ opacity: 1 });
    dippedThisTask.current = true;
    setTimeout(() => {
      dippedThisTask.current = false;
    }, 0);
  }, [shownId, fade]);

  // The browser's Back and Forward (a popstate that is not the panel's own `router.back()`): `isHistoryStep` is true for a
  // moment, so an open they bring does not slide (below), and `poppedAt` keeps the item fade out of it. Next's own popstate
  // listener is registered first and may commit the new URL before this one runs, in the same task: the dip it started is
  // ended here before the browser paints it, and the open's slide is dropped by the next render.
  const ownBackAt = useRef(Number.NEGATIVE_INFINITY);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [isHistoryStep, setHistoryStep] = useState(false);
  useEffect(() => {
    const onPopState = () => {
      if (performance.now() - ownBackAt.current < OWN_BACK_WINDOW_MS) {
        ownBackAt.current = Number.NEGATIVE_INFINITY;
        return;
      }
      poppedAt.current = performance.now();
      if (dippedThisTask.current) fade.set({ opacity: 1 });
      setHistoryStep(true);
      clearTimeout(historyTimer.current);
      historyTimer.current = setTimeout(() => setHistoryStep(false), POPSTATE_WINDOW_MS);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [fade]);

  // The detail (editor included) is a separate chunk (./peek-detail-lazy.tsx): fetch it when idle or on the first row contact, so the
  // first peek finds it loaded. A peek already named by the URL (a deep link, a reload) needs it now.
  useEffect(() => schedulePreload(window, preloadPeekDetail), []);
  useEffect(() => {
    if (isOpen) preloadPeekDetail();
  }, [isOpen]);

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
    // A second close while the panel is leaving does nothing (the first one already navigates). The panel stays held out after
    // its exit ends, until the URL drops the item, so the marker on the panel says it is leaving, not only the running exit.
    if (exit.current !== null || panelRef.current?.hasAttribute(EXITING_ATTRIBUTE)) return;
    const target = peekHref(pathname, searchParams, null);
    const push = readPeekPush();
    clearPeekPush();
    const panel = panelRef.current;
    if (peek !== null && !isModal && panel !== null) {
      // The detail stays on screen while it leaves, so focus inside it would still sit there when the list takes over:
      // let it go now, and the focus return (peek-cover.ts) finds it free in the commit that closes. Inert keeps it out after.
      const active = document.activeElement;
      if (active instanceof HTMLElement && panel.contains(active)) active.blur();
      hold(panel);
      const controller = new AbortController();
      exit.current = controller;
      setLeaving(peek);
      const settle = () => {
        if (exit.current === controller) exit.current = null;
        setLeaving(null);
      };
      playExit(panel, { signal: controller.signal }).then(settle, (error: unknown) => {
        release(panel);
        settle();
        ignoreCancelled(error);
      });
    }
    if (closesWithBack(push, here, target, window.history.length)) {
      ownBackAt.current = performance.now();
      router.back();
    } else router.replace(target, { scroll: false });
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

  // The covered list is inert (decision 11): out of the tab order and the accessibility tree while the panel is on top of it.
  // The attribute goes in the same commit as the close, before the focus returns to the row (useCoverFocus).
  const isListCovered = isOpen && !isModal && isPanelCover;
  // Focus moves into the detail once it has controls: the loaded detail (./peek-detail-lazy.tsx) or the not-found panel, not the skeleton.
  const [isDetailMounted, setDetailMounted] = useState(false);
  const hasFocusTarget = isDetailMounted || (peek !== null && peek.data === null);
  const rememberListOpener = useCoverFocus({ isOpen, isModal, isCovering: isListCovered }, hasFocusTarget ? slotNode : null);

  const detail = shown ? (
    shown.data ? (
      <PeekDetail key={shown.id} data={shown.data} host={isModal ? "modal" : "peek"} onClose={close} onHostChange={changeHost} onOpenItem={openItem} onMountedChange={setDetailMounted} />
    ) : (
      <PeekNotFound key={shown.id} id={shown.id} onClose={close} />
    )
  ) : null;

  // True for the commit where the side panel opens after mount, until its animation ends. A host that mounts with the peek already
  // open (a `?peek=` deep link, a navigation to one) never animates, hydrated or client-rendered (a freshly streamed page client-renders
  // its list): the enter is for a user's open, so it waits until the host has been closed once.
  const [hasBeenClosed, setHasBeenClosed] = useState(shown === null);
  if (!hasBeenClosed && shown === null) setHasBeenClosed(true);
  const opens = hasBeenClosed && shown !== null && !isModal;
  // An open that the browser's Back or Forward brought stays still, and stays so for as long as that panel is open (the window
  // `isHistoryStep` covers ends meanwhile, and the flag must not turn true again then). The state is derived while rendering,
  // like useEnterFlag's own: no effect sets it.
  const [entry, setEntry] = useState({ opens, byHistory: false });
  const byHistory = opens && (isHistoryStep || (entry.opens && entry.byHistory));
  if (entry.opens !== opens || entry.byHistory !== byHistory) setEntry({ opens, byHistory });
  const enter = useEnterFlag(opens && !byHistory);
  const sidePanel =
    shown !== null && !isModal ? (
      <>
        {isPanelCapped || isPanelCover ? null : <ResizeHandle resizable={panel.props} direction="horizontal" isReversed hasDivider={false} label="Resize the work item panel" />}
        <LayoutPanel
          ref={panelRef}
          resizable={panel.props}
          hasDivider={false}
          padding={1}
          isScrollable={false}
          label="Work item"
          role="complementary"
          className={isPanelCover ? "tessera-peek-panel tessera-peek-panel--cover tessera-motion-fade" : "tessera-peek-panel tessera-motion-slide-end"}
          {...enter}
        >
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
        className="tessera-peek-layout"
        content={
          <LayoutContent padding={0} isScrollable inert={isListCovered} {...rememberListOpener}>
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
