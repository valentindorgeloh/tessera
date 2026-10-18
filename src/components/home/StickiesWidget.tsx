"use client";

/**
 * Stickies preview on Home (docs/drafts/p9-plan.md U1): up to six notes.
 * A new sticky is created, then the stickies page opens on it.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { createStickyAction } from "@/app/actions/stickies";
import "@/components/styles/stickies.css";
import { PlusIcon } from "@/themes/catppuccin/icons";
import { entityId, stickyColorClass, stickyPreview, stickyTitle, type StickyView } from "./home-format";

export type StickiesWidgetProps = { stickies: StickyView[] };

/** Grid's minWidth is a pixel count. 240 is the card's structural minimum. */
const STICKY_COLUMN_MIN = 240;

export function StickiesWidget({ stickies }: StickiesWidgetProps) {
  const router = useRouter();
  const toast = useToast();
  const [isCreating, startCreate] = useTransition();
  const create = () => {
    if (isCreating) return;
    startCreate(async () => {
      const result = await createStickyAction({});
      if (!result.ok) {
        toast({ type: "error", body: `Could not create the sticky. ${result.message}` });
        return;
      }
      const id = entityId(result.data);
      router.push(id === null ? "/stickies" : `/stickies#${id}`);
    });
  };
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
        <Heading level={4} accessibilityLevel={2}>
          Stickies
        </Heading>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button variant="secondary" size="sm" label="New sticky" icon={<PlusIcon />} onClick={create} isLoading={isCreating} />
          <Button variant="ghost" size="sm" label="All stickies" href="/stickies" />
        </HStack>
      </HStack>
      {stickies.length === 0 ? null : (
        <Grid className="tessera-sticky-grid" columns={{ minWidth: STICKY_COLUMN_MIN, max: 6, repeat: "fit" }} gap={3}>
          {stickies.map((sticky) => {
            const title = stickyTitle(sticky.name);
            const preview = stickyPreview(sticky.description_md);
            return (
              <ClickableCard key={sticky.id} label={title} href={`/stickies#${sticky.id}`} padding={3} className={stickyColorClass(sticky.color)}>
                <VStack gap={1}>
                  <Text weight="medium" maxLines={1}>
                    {title}
                  </Text>
                  {preview === "" ? null : (
                    <Text type="supporting" color="secondary" maxLines={3}>
                      {preview}
                    </Text>
                  )}
                </VStack>
              </ClickableCard>
            );
          })}
        </Grid>
      )}
    </VStack>
  );
}
