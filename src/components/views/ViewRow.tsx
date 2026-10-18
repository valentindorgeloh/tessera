"use client";

/**
 * One saved view in the views list (docs/drafts/p4-ui.md "ViewRow"). The row
 * links to the view through ListItem's invisible anchor, so the menu in
 * `endContent` is a sibling of the link, never nested in it. Also exports the
 * lock indicator the view page puts next to its title.
 */
import { Icon } from "@astryxdesign/core/Icon";
import { ListItem } from "@astryxdesign/core/List";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { FavoriteButton } from "@/components/shell/FavoriteButton";
import type { View } from "@/lib/tessera/types";
import { LockIcon, ViewIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { ViewMenu } from "./ViewMenu";
import { viewSummary } from "./view-state";

export type ViewRowProps = {
  /** Null links to `/workspace-views/<id>`. */
  projectId: string | null;
  view: View;
  count: number;
  /** When set, the row shows the favourite star. Project lists omit it. */
  isFavorite?: boolean;
  /** The neighbouring rows' ids in the shown order. */
  previousId?: string;
  nextId?: string;
  /** False while the search field has text (a filtered list has no stable neighbours). */
  canReorder: boolean;
};

/** The lock icon with its tooltip; a row of a locked view and the view page's title adornment. */
export function ViewLockIndicator() {
  return (
    <Tooltip content="Locked: unlock to edit">
      <Icon icon={LockIcon} color="secondary" size="sm" label="Locked" />
    </Tooltip>
  );
}

/** First line of the description, or the layout, grouping and filter summary. */
function rowDescription(view: View): string {
  const firstLine = view.description.split("\n")[0]?.trim() ?? "";
  return firstLine !== "" ? firstLine : viewSummary(view);
}

export function ViewRow({ projectId, view, count, isFavorite, previousId, nextId, canReorder }: ViewRowProps) {
  return (
    <ListItem
      href={projectId === null ? `/workspace-views/${view.id}` : `/projects/${projectId}/views/${view.id}`}
      startContent={<Icon icon={view.logo ? resolveLogoIcon(view.logo.icon) : ViewIcon} color={view.logo?.color ?? "secondary"} size="sm" />}
      label={view.name}
      description={rowDescription(view)}
      endContent={
        <HStack gap={2} vAlign="center">
          {isFavorite === undefined ? null : <FavoriteButton entityType="view" entityId={view.id} isFavorite={isFavorite} />}
          {view.is_locked ? <ViewLockIndicator /> : null}
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {count === 1 ? "1 work item" : `${count} work items`}
          </Text>
          <ViewMenu projectId={projectId} view={view} placement="row" previousId={previousId} nextId={nextId} canReorder={canReorder} />
        </HStack>
      }
    />
  );
}
