"use client";

import type {RefObject} from "react";
import {Outline, parseOutlineFromMarkdown} from "@astryxdesign/core/Outline";

export function outlineItems(body: string) {
  return parseOutlineFromMarkdown(body);
}

export function PageOutline({
  body,
  scrollContainerRef,
}: {
  body: string;
  scrollContainerRef: RefObject<HTMLElement | null>;
}) {
  const items = outlineItems(body);
  if (items.length < 2) return null;
  return (
    <Outline
      items={items}
      density="compact"
      label="On this page"
      scrollContainerRef={scrollContainerRef}
    />
  );
}
