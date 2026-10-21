"use client";

/**
 * "Mentioned in" of a work item (decision 44, docs/PLAN.md section 12 step 7):
 * the pages that embed the item with a `work:KEY` link, one row each, opening
 * the page. An archived page stays listed and is marked. Nothing renders when
 * no page embeds the item.
 */
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { pageHref } from "@/components/pages/page-tree";
import type { PageBacklink } from "@/lib/tessera/types";
import { PageIcon } from "@/themes/catppuccin/icons";

export type MentionedInProps = {
  backlinks: readonly PageBacklink[];
};

export function MentionedIn({ backlinks }: MentionedInProps) {
  if (backlinks.length === 0) return null;
  return (
    <VStack gap={2} className="tessera-detail-links">
      <Text type="label" color="secondary">
        Mentioned in ({backlinks.length})
      </Text>
      <VStack gap={0} as="ul" aria-label="Mentioned in">
        {backlinks.map((entry) => (
          <HStack key={entry.id} gap={2} vAlign="center" className="tessera-detail-row" as="li">
            <Icon icon={PageIcon} size="sm" color="secondary" />
            <HStack gap={2} vAlign="center" className="tessera-detail-row-name">
              <Link href={pageHref(entry)} maxLines={1}>
                {entry.name}
              </Link>
              {entry.archived_at ? (
                <Text type="supporting" color="secondary">
                  Archived
                </Text>
              ) : null}
            </HStack>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}
