import type { ReactNode } from "react";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";

/**
 * Panel headers (docs/contracts/ui.md "Shell", "Panel headers"): the slim
 * bars at the top of the content panel. A screen puts one `PanelHeader` (one
 * header landmark, hairline below) in its Layout's header slot and stacks
 * `PanelBar` rows in it: the 52px page header (title, tabs, page actions),
 * the 44px sub-header (the view's name and count, layout, display and the
 * primary action) and the 44px filters row. A row is a plain stack, not an
 * Astryx Toolbar, so the tabs and the filter field inside it keep their own
 * arrow-key handling.
 */
export function PanelHeader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <LayoutHeader hasDivider padding={0} label={label}>
      {children}
    </LayoutHeader>
  );
}

export type PanelBarSize = "header" | "subheader" | "filters";

const BAR_CLASS: Readonly<Record<PanelBarSize, string>> = {
  header: "tessera-panel-bar tessera-panel-bar--header",
  subheader: "tessera-panel-bar tessera-panel-bar--subheader",
  filters: "tessera-panel-bar tessera-panel-bar--filters",
};

/**
 * One row of a panel header: `start` (title, tabs, filters) grows and may
 * shrink, `end` (actions) keeps its size. A row after the first one draws a
 * hairline above itself (`hasDivider`).
 */
export function PanelBar({ size = "header", start, end, hasDivider = false }: { size?: PanelBarSize; start: ReactNode; end?: ReactNode; hasDivider?: boolean }) {
  return (
    <HStack gap={3} vAlign="center" paddingInline={4} className={hasDivider ? `${BAR_CLASS[size]} tessera-panel-bar--divided` : BAR_CLASS[size]}>
      <HStack gap={2} vAlign="center" className="tessera-panel-bar-start">
        {start}
      </HStack>
      {end ? (
        <HStack gap={2} vAlign="center" className="tessera-panel-bar-end">
          {end}
        </HStack>
      ) : null}
    </HStack>
  );
}

/**
 * The page title in a panel header: the document's h1, set at the working
 * size (14px, medium) like the rest of the header rather than at display size.
 */
export function PanelTitle({ children }: { children: string }) {
  return (
    <Heading level={4} accessibilityLevel={1} maxLines={1}>
      {children}
    </Heading>
  );
}

/**
 * A page in the content panel: the header pinned at the top and the content
 * scrolling under it. `width="reading"` centres the content in a 960px
 * column (Home, Projects, not found); `"full"` gives it the panel's width.
 */
export function PanelPage({ header, width = "full", children }: { header: ReactNode; width?: "reading" | "full"; children: ReactNode }) {
  return (
    <Layout
      height="fill"
      header={header}
      content={
        <LayoutContent isScrollable padding={0}>
          {width === "reading" ? <div className="tessera-reading">{children}</div> : children}
        </LayoutContent>
      }
    />
  );
}
