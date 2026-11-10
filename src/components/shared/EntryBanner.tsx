"use client";

/**
 * A Banner that slides in when it appears after the page has loaded: a conflict
 * while someone types, an error after a save, a notice after a switch. Astryx's
 * own `useEntryAnimation("slideDown")` (8px, `--duration-fast-max`, off under
 * Reduce Motion) goes to the Banner's `xstyle`, which Astryx documents and
 * which needs no StyleX compiler (docs/contracts/ui.md "Motion").
 *
 * The hook reads "was this mounted after the first paint, and not while
 * hydrating" ONCE, in the component that calls it. So it lives here, in a
 * component that mounts together with the banner: called from the screen that
 * holds the banner's condition, it would be decided when the screen first
 * rendered and never animate a banner that comes later. A banner that is part
 * of the page when it loads (or hydrates) gets `null` and does not move.
 *
 * The style leaves the Banner once the slide has played: with cache components a
 * left route stays mounted under Activity (display: none), and a banner still on
 * screen would otherwise replay its slide each time the route is shown again
 * (Back, a link). Only the frame's own animationend counts; the events of what is
 * inside it bubble up and are ignored.
 *
 * Use it for banners that appear in answer to what the person did. A banner that
 * is part of the page's content (an archived project, a read-only item) uses the
 * plain Banner. This component adds no role: pass `role="alert"` for an urgent
 * message, or announce from the handler (`useAnnounce`), never both for the same words.
 */
import { useState, type ComponentProps } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { useEntryAnimation } from "@astryxdesign/core/hooks";

export type EntryBannerProps = Omit<ComponentProps<typeof Banner>, "xstyle">;

export function EntryBanner({ onAnimationEnd, ...props }: EntryBannerProps) {
  const entry = useEntryAnimation("slideDown");
  const [played, setPlayed] = useState(false);
  return (
    <Banner
      {...props}
      xstyle={played ? undefined : (entry ?? undefined)}
      onAnimationEnd={(event) => {
        onAnimationEnd?.(event);
        if (event.target === event.currentTarget) setPlayed(true);
      }}
    />
  );
}
