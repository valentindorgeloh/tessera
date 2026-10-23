"use client";

/**
 * Whether the element behind `ref` is narrower than `minWidth` px. The settings
 * tables (exports, webhook deliveries) show every column when they fit and fold
 * the secondary ones under the first cell when they do not, so a row's actions
 * stay in view without a hidden horizontal swipe (visual audit, settings lane).
 * The container is measured, not the viewport: the settings column loses 300px
 * to the app sidebar and the settings tabs at 768px. The server render and the
 * first paint are wide; a phone folds right after hydration.
 */
import { useEffect, useState } from "react";

export function useNarrowContainer(minWidth: number): { ref: (node: HTMLElement | null) => void; isNarrow: boolean } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (node === null) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setIsNarrow(width < minWidth);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, minWidth]);
  return { ref: setNode, isNarrow };
}
