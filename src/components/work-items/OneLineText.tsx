"use client";

import { useEffect, useRef, useState, type ComponentProps, type PointerEvent as ReactPointerEvent } from "react";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";

/** Astryx Tooltip's own show delay, so a pointer sweeping across rows opens nothing. */
const SHOW_DELAY_MS = 200;

export type OneLineTextProps = Omit<ComponentProps<typeof Text>, "children" | "maxLines" | "hasTruncateTooltip" | "ref"> & {
  /** The whole text; the tooltip repeats it when the line is cut. */
  children: string;
  /** A class that cuts the Text to one line with a CSS ellipsis (`tessera-wi-title`, `tessera-wi-cell-text`, the gantt label classes). */
  className: string;
};

/**
 * A one-line Text whose full text shows in a tooltip while the mouse rests on it, only when the line is cut.
 * It replaces Astryx `Text maxLines={1}`, which gives the same tooltip but measures every Text when it mounts
 * (a forced layout each, thousands in a long list or table). This one measures nothing until the mouse has
 * rested on it for the tooltip delay, then compares `scrollWidth` with `clientWidth` once. The tooltip is
 * Astryx's sibling mode (`anchorRef`), like the truncation tooltip of Astryx Text, but controlled: it closes on
 * leave, on a press and on Escape. The Text is not focusable and touch has no hover, so, like Astryx's, it opens
 * for a mouse only.
 */
export function OneLineText({ children, className, onPointerEnter, onPointerLeave, onPointerDown, ...textProps }: OneLineTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [isHovered, setHovered] = useState(false);
  const [isTipOpen, setTipOpen] = useState(false);

  useEffect(() => {
    if (!isHovered) return;
    const timer = setTimeout(() => {
      const element = ref.current;
      if (element && element.scrollWidth > element.clientWidth) setTipOpen(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isHovered]);

  return (
    <>
      <Text
        {...textProps}
        ref={ref}
        className={className}
        onPointerEnter={(event: ReactPointerEvent<HTMLElement>) => {
          onPointerEnter?.(event);
          if (event.pointerType !== "touch") setHovered(true);
        }}
        onPointerLeave={(event: ReactPointerEvent<HTMLElement>) => {
          onPointerLeave?.(event);
          setHovered(false);
          setTipOpen(false);
        }}
        onPointerDown={(event: ReactPointerEvent<HTMLElement>) => {
          onPointerDown?.(event);
          setTipOpen(false);
        }}
      >
        {children}
      </Text>
      {isTipOpen ? (
        <Tooltip
          anchorRef={ref}
          content={children}
          isOpen
          focusTrigger="never"
          touchTrigger="none"
          onOpenChange={(isOpen) => {
            if (!isOpen) setTipOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
