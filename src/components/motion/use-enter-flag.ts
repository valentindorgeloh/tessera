"use client";

/**
 * `data-enter` for a surface that OPENS after mount: the one thing the Tessera
 * CSS slide (src/components/styles/motion.css) needs to know. Spread the result
 * on the surface that carries `tessera-motion-slide-end` (or `-fade`, `-rise`):
 *
 *   const enter = useEnterFlag(isOpen);
 *   <LayoutPanel className="tessera-motion-slide-end" {...enter}>
 *
 * Use it only for the side-panel slides (the peek card and the assistant panel),
 * which Astryx has no preset for (no preset slides horizontally). Everything
 * else that appears after load, such as a banner, a status line, a placeholder
 * row or the bulk bar, uses Astryx's own `useEntryAnimation(preset)` from
 * `@astryxdesign/core/hooks`, passed to the component's `xstyle`. Do not put
 * either on ordinary list rows or cards: they mount on scroll and on the
 * agent refresh, and those must not animate.
 *
 * The flag is true only for an open that happens on the client:
 * - never on the server render or on the client render that hydrates server
 *   HTML (a `?peek=` deep link, a stored open assistant panel), which must
 *   match the server markup (React error 418) and must not move;
 * - not for a surface that is already open when its host first mounts through
 *   hydration; but a host that mounts after hydration with `open` true (the
 *   assistant panel renders only while open) is an open after mount, so it slides;
 * - true again each time `open` goes from false to true;
 * - cleared by the surface's own `animationend`, so an Activity reveal later
 *   (display none to shown restarts a CSS animation) does not replay the slide.
 *   Under Reduce Motion nothing runs and the flag just stays, harmlessly:
 *   every Tessera rule is `animation: none` there.
 *
 * Hydration is read the way Astryx's own entry animation reads it
 * (`useSyncExternalStore` with a server snapshot of true), because Astryx does
 * not export `useIsHydrating`. The state is derived during render from the
 * previous `open` (React's "previous prop in state" pattern); there is no
 * effect and no setState in one.
 */
import { useCallback, useMemo, useState, useSyncExternalStore, type AnimationEvent } from "react";

export type EnterFlagProps = {
  /** Present (empty string) while the surface is entering; absent otherwise. */
  "data-enter"?: "";
  /** Clears the flag when the surface's own animation ends. Absent while not entering. */
  onAnimationEnd?: (event: AnimationEvent<HTMLElement>) => void;
};

/** What a surface that is not entering spreads: nothing. One shared object, so props keep their identity. */
const NOT_ENTERING: EnterFlagProps = Object.freeze({});

const subscribe = () => () => {};
const getSnapshot = () => false;
/** True on the server and during the client render that hydrates server HTML. */
const getServerSnapshot = () => true;

export function useEnterFlag(open: boolean = true): EnterFlagProps {
  const hydrating = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [state, setState] = useState(() => ({ open, entering: open && !hydrating }));
  if (state.open !== open) {
    // `open` changed after mount, so this is a client render: an open enters, a close does not.
    setState({ open, entering: open });
  }
  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    // A child's animation bubbles up here; only the surface's own ends the enter.
    if (event.target !== event.currentTarget) return;
    setState((current) => (current.entering ? { ...current, entering: false } : current));
  }, []);
  return useMemo<EnterFlagProps>(() => (state.entering ? { "data-enter": "", onAnimationEnd } : NOT_ENTERING), [state.entering, onAnimationEnd]);
}
