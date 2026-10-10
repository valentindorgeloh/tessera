"use client";

import type {ReactNode} from "react";
import {VStack} from "@astryxdesign/core/Layout";

/**
 * Notion-style page frame: a centered 708px reading column with a gutter on
 * each side that gives block handles, table handles and the `+` bars room to
 * sit beside the content. `PAGE_FRAME_WIDTH` is the column plus both gutters
 * and feeds `Layout contentWidth` so the frame centers inside the shell.
 */
export const PAGE_COLUMN_WIDTH = 708;
export const PAGE_GUTTER = 112;
export const PAGE_FRAME_WIDTH = PAGE_COLUMN_WIDTH + PAGE_GUTTER * 2;

export function PageColumn({children}: {children: ReactNode}) {
  return (
    <VStack className="handbook-page" gap={0}>
      {children}
    </VStack>
  );
}
