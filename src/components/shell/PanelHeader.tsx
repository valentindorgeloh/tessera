import type { ReactNode } from "react";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";

/**
 * Panel headers (docs/contracts/ui.md "Shell", "Panel headers"): the slim
 * bars at the top of the content panel. A screen puts one `PanelHeader` (an
 * Astryx LayoutHeader, hairline below) in its Layout's header slot and stacks
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

export type PanelBarProps = {
  size?: PanelBarSize;
  start: ReactNode;
  end?: ReactNode;
  hasDivider?: boolean;
  /** Extra class for a bar that is not in a PanelHeader (the detail header pins itself). */
  className?: string;
  /**
   * Lets the row wrap when `start` and `end` do not fit on one line (a phone,
   * the peek panel open): `end` drops under `start` and wraps its own actions.
   * Off by default, where `start` shrinks instead (the tabs scroll, the
   * filter field narrows).
   */
  canWrap?: boolean;
  /**
   * For a bar whose `start` is a title followed by a `TabList`: below 600px the
   * bar becomes two rows, the title and `end` on a 44px row and the tabs on
   * their own full-width row docked on the hairline, with 44px tabs
   * (shell.css `tessera-panel-bar--tabs-below`). `start` must hold the title as
   * one element (wrap a token and a name together) and the TabList last. From
   * 600px up it changes nothing. Do not combine it with `canWrap`.
   */
  tabsBelow?: boolean;
};

/**
 * One row of a panel header: `start` (title, tabs, filters) grows and may
 * shrink, `end` (actions) keeps its size unless the row wraps (`canWrap`). A
 * row after the first one draws a hairline above itself (`hasDivider`).
 */
export function PanelBar({ size = "header", start, end, hasDivider = false, className, canWrap = false, tabsBelow = false }: PanelBarProps) {
  const classes = [
    BAR_CLASS[size],
    hasDivider ? "tessera-panel-bar--divided" : null,
    canWrap ? "tessera-panel-bar--wraps" : null,
    tabsBelow ? "tessera-panel-bar--tabs-below" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");
  const wrap = canWrap ? "wrap" : "nowrap";
  return (
    <HStack gap={3} vAlign="center" paddingInline={4} wrap={wrap} className={classes}>
      <HStack gap={2} vAlign="center" className="tessera-panel-bar-start">
        {start}
      </HStack>
      {end ? (
        <HStack gap={2} vAlign="center" hAlign="end" wrap={wrap} className="tessera-panel-bar-end">
          {end}
        </HStack>
      ) : null}
    </HStack>
  );
}

/**
 * The page title in a panel header: the document's h1, set at the working
 * size (14px, medium) like the rest of the header rather than at display size.
 * `accessibilityLevel` is 2 where the page body owns the h1 (the project
 * frame's title on a work item page, whose item title is the only level 1).
 */
export function PanelTitle({ children, className, accessibilityLevel = 1 }: { children: string; className?: string; accessibilityLevel?: 1 | 2 }) {
  return (
    <Heading level={4} accessibilityLevel={accessibilityLevel} maxLines={1} className={className}>
      {children}
    </Heading>
  );
}

/**
 * A page in the content panel: the header pinned at the top and the content
 * scrolling under it. `width="reading"` centres the content in a 960px
 * column (Home, Projects); `"full"` gives it the panel's width.
 */
export function PanelPage({ header, width = "full", children }: { header: ReactNode; width?: "reading" | "full"; children: ReactNode }) {
  return (
    <Layout
      height="fill"
      header={header}
      content={
        <LayoutContent isScrollable padding={0}>
          {width === "reading" ? <VStack className="tessera-reading">{children}</VStack> : children}
        </LayoutContent>
      }
    />
  );
}
