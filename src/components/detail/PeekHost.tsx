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
 * The detail is a separate chunk (./peek-detail-lazy.tsx, decision 142): the
 * editor stays out of the list routes' first load. The chunk is fetched when
 * the browser is idle or on the first pointer or focus contact with a list
 * row, and at once when the URL already names a peek; a peek opened before it
 * arrives shows the same skeleton as the slot before its mount node exists.
 *
 * Motion (decisions 132 and 133, ./peek-motion.ts): the side panel takes its
 * final width at once and only the card slides, in on open and out on close;
 * the close navigates when its slide finishes. Motion only changes the
 * panel's `inert` and `data-motion` props and the card's WAAPI animations, so
 * the detail is never remounted for it. Nothing slides on the first render,
 * a mode switch, a switch of item, browser Back or under reduced motion.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { VStack } from "@astryxdesign/core/Stack";
import { animateSlide, prefersReducedMotion } from "@/components/shell/layout-motion";
import { recordVisit } from "@/components/shell/recents-store";
import { IdSchema } from "@/lib/tessera/schemas";
import { workItemPath } from "./DetailHeader";
import { PeekDetail, PeekSkeleton, preloadPeekDetail, schedulePreload } from "./peek-detail-lazy";
import type { DetailHost, WorkItemDetailData } from "./types";
import { clearPeekPush, movePeekPush, readPeekPush, stampPeekPush } from "./peek-history";
import { registerPeekHost } from "./peek-hosts";
import { PEEK_MAX_WIDTH, PEEK_MIN_WIDTH, hasNoResizeRange, loadPeekPrefs, savePeekPrefs, usePeekPrefs } from "./peek-prefs";
import { useCoverFocus, useIsPanelCover } from "./peek-cover";
import { closeOutcome, peekCloseAnimates, peekOpenAnimates, slideOffset } from "./peek-motion";
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

/** The card's running slide; a close remembers the URL it closes. */
type PeekMotion = { animation: Animation; kind: "open" } | { animation: Animation; kind: "close"; hrefAtClose: string };

/** The side panel's computed end padding in px (4px for `padding={1}`), so the card slides from fully outside it. */
function panelPadEnd(card: HTMLElement): number {
  const host = card.closest<HTMLElement>(".tessera-peek-panel");
  if (host === null) return 0;
  const pad = Number.parseFloat(getComputedStyle(host).paddingInlineEnd);
  return Number.isFinite(pad) ? pad : 0;
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

  // Side peek motion (decisions 132 and 133): the first render's state counts as already there, so a reload or a deep link
  // with `?peek=` never slides.
  const cardRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(isOpen);
  const prevModal = useRef(isModal);
  const motionRef = useRef<PeekMotion | null>(null);
  // Set when a close slide starts; cleared only in the animation's callbacks. The panel stays inert (Escape off) until the URL
  // has changed, which also ends `isClosing` by itself.
  const [closingHref, setClosingHref] = useState<string | null>(null);
  const isClosing = closingHref !== null && closingHref === here;

  // Back to the entry the list pushed, else a replace; decided when it runs (after the slide, not at the click).
  const navigateClose = () => {
    const target = peekHref(pathname, searchParams, null);
    const push = readPeekPush();
    clearPeekPush();
    if (closesWithBack(push, here, target, window.history.length)) router.back();
    else router.replace(target, { scroll: false });
  };
  const close = () => {
    const running = motionRef.current;
    // A second Escape or Close click while the card slides out, or while the router lands the URL, does nothing.
    if (running?.kind === "close") return;
    if (running !== null) {
      motionRef.current = null;
      running.animation.cancel();
    }
    const card = cardRef.current;
    const isHidden = card === null || !card.isConnected || card.offsetParent === null;
    if (card === null || !peekCloseAnimates({ isModal, reduced: prefersReducedMotion(), isHidden })) {
      navigateClose();
      return;
    }
    const hrefAtClose = here;
    const animation = animateSlide(card, "none", slideOffset(panelPadEnd(card)), { fill: "forwards" });
    if (animation === null) {
      navigateClose();
      return;
    }
    const motion: PeekMotion = { animation, kind: "close", hrefAtClose };
    motionRef.current = motion;
    setClosingHref(hrefAtClose);
    const release = () => {
      if (motionRef.current === motion) motionRef.current = null;
      setClosingHref((current) => (current === hrefAtClose ? null : current));
    };
    // A cancel after the finish (the URL moved on, the route hid) no longer rejects `finished`; the event covers both cases.
    animation.addEventListener("cancel", release);
    animation.finished.then(() => {
      // Cancelled between the finish and this callback (hidden or unmounted): never navigate.
      if (motionRef.current !== motion) return;
      const hrefNow = currentHref(window.location.pathname, window.location.search);
      // The card stays out (`fill: "forwards"`) and the guard stays on until the URL has changed.
      if (closeOutcome({ ended: "finished", hrefAtClose, hrefNow }) === "navigate") navigateClose();
      else animation.cancel();
    }, release);
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
  useHotkeys([{ keys: "escape", onPress: close, allowInInputs: true, isDisabled: !isOpen || isModal || isClosing }]);

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
  const watchCard = useCallback(
    (element: HTMLElement | null) => {
      cardRef.current = element;
      const stop = watchPanelAndCover(element);
      return () => {
        cardRef.current = null;
        stop();
      };
    },
    [watchPanelAndCover],
  );

  // The covered list is inert (decision 11): out of the tab order and the accessibility tree while the panel is on top of it.
  // The attribute goes in the same commit as the close, before the focus returns to the row (useCoverFocus).
  const isListCovered = isOpen && !isModal && isPanelCover;
  // Focus moves into the detail once it has controls: the loaded detail (./peek-detail-lazy.tsx) or the not-found panel, not the skeleton.
  const [isDetailMounted, setDetailMounted] = useState(false);
  const hasFocusTarget = isDetailMounted || (peek !== null && peek.data === null);
  const rememberListOpener = useCoverFocus({ isOpen, isModal, isCovering: isListCovered }, hasFocusTarget ? slotNode : null);

  // The open slide, after useCoverFocus so the focus keeps its own timing. `isDetailMounted` is not a dependency: the lazy
  // detail replaces the skeleton inside the same card without restarting the slide.
  useLayoutEffect(() => {
    const animates = peekOpenAnimates({ wasOpen: wasOpen.current, isOpen, isModal, modeChanged: prevModal.current !== isModal, reduced: prefersReducedMotion() });
    wasOpen.current = isOpen;
    prevModal.current = isModal;
    const card = cardRef.current;
    if (!animates || card === null) return;
    const animation = animateSlide(card, slideOffset(panelPadEnd(card)), "none");
    if (animation === null) return;
    const motion: PeekMotion = { animation, kind: "open" };
    motionRef.current = motion;
    const settle = () => {
      if (motionRef.current === motion) motionRef.current = null;
    };
    animation.finished.then(settle, settle);
  }, [isOpen, isModal]);

  // A close slide is done once the URL leaves the one it closed: the card went with the panel, or (another item opened by
  // other means) it returns. The cancel's callback clears `closingHref`; this effect sets no state.
  useLayoutEffect(() => {
    const motion = motionRef.current;
    if (motion === null || motion.kind !== "close" || motion.hrefAtClose === here) return;
    motionRef.current = null;
    motion.animation.cancel();
  }, [here]);

  // Hide (Next's <Activity>) and unmount run this cleanup: a running slide is cancelled, so a close started just before
  // the user left the route never navigates.
  useLayoutEffect(
    () => () => {
      const motion = motionRef.current;
      motionRef.current = null;
      motion?.animation.cancel();
    },
    [],
  );

  const detail = peek ? (
    peek.data ? (
      <PeekDetail key={peek.id} data={peek.data} host={isModal ? "modal" : "peek"} onClose={close} onHostChange={changeHost} onOpenItem={openItem} onMountedChange={setDetailMounted} />
    ) : (
      <PeekNotFound key={peek.id} id={peek.id} onClose={close} />
    )
  ) : null;

  const sidePanel =
    isOpen && !isModal ? (
      <>
        {isPanelCapped || isPanelCover ? null : <ResizeHandle resizable={panel.props} direction="horizontal" isReversed hasDivider={false} label="Resize the work item panel" />}
        <LayoutPanel
          resizable={panel.props}
          hasDivider={false}
          padding={1}
          isScrollable={false}
          label="Work item"
          role="complementary"
          className={isPanelCover ? "tessera-peek-panel tessera-peek-panel--cover" : "tessera-peek-panel"}
          inert={isClosing}
          data-motion={isClosing ? "closing" : undefined}
        >
          <Card ref={watchCard} padding={0} height="100%" elevation="low" className="tessera-peek-card">
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
