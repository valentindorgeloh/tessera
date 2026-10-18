"use client";

/**
 * Stickies at `/stickies` (docs/drafts/p9-plan.md U1). Search writes `?q=`
 * after a short pause. New notes are created first and the page scrolls to them.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createStickyAction } from "@/app/actions/stickies";
import { entityId, type StickyView } from "@/components/home/home-format";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import "@/components/styles/stickies.css";
import { DraftIcon, PlusIcon, SearchIcon } from "@/themes/catppuccin/icons";
import { StickyCard } from "./StickyCard";

export type StickiesScreenProps = {
  stickies: StickyView[];
  q: string;
};

/** Grid's minWidth is a pixel count. 240 is the card's structural minimum. */
const STICKY_COLUMN_MIN = 240;
const SEARCH_DELAY_MS = 300;

export function StickiesScreen({ stickies, q }: StickiesScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(q);
  const wrote = useRef(q);
  const [isCreating, startCreate] = useTransition();

  useEffect(() => {
    if (q === wrote.current) return;
    wrote.current = q;
    setDraft(q);
  }, [q]);

  useEffect(() => {
    const next = draft.trim();
    if (next === q) return;
    const handle = window.setTimeout(() => {
      wrote.current = next;
      router.replace(next === "" ? "/stickies" : `/stickies?${new URLSearchParams({ q: next }).toString()}`, { scroll: false });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [draft, q, router]);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (id === "") return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [stickies]);

  const create = () => {
    if (isCreating) return;
    startCreate(async () => {
      const result = await createStickyAction({});
      if (!result.ok) {
        toast({ type: "error", body: `Could not create the sticky. ${result.message}` });
        return;
      }
      const id = entityId(result.data);
      if (id !== null) router.push(`/stickies#${id}`);
    });
  };

  const searching = q.trim() !== "";
  return (
    <PanelPage
      header={
        <PanelHeader label="Stickies">
          <PanelBar
            canWrap
            start={<PanelTitle>Stickies</PanelTitle>}
            end={
              <HStack gap={2} vAlign="center" wrap="wrap">
                <TextInput
                  label="Search stickies"
                  isLabelHidden
                  size="sm"
                  value={draft}
                  onChange={setDraft}
                  placeholder="Search notes"
                  startIcon={SearchIcon}
                  hasClear
                  className="tessera-stickies-search"
                />
                <Button variant="primary" size="sm" label="New sticky" icon={<PlusIcon />} onClick={create} isLoading={isCreating} />
              </HStack>
            }
          />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6}>
        {stickies.length === 0 ? (
          <EmptyState
            icon={<Icon icon={DraftIcon} size="lg" color="secondary" />}
            title={searching ? "No matching stickies" : "No stickies yet"}
            description={searching ? "Try a different search." : "Notes live on the workspace, outside any project."}
            actions={searching ? undefined : <Button variant="primary" label="New sticky" icon={<PlusIcon />} onClick={create} isLoading={isCreating} />}
          />
        ) : (
          <Grid className="tessera-sticky-grid" columns={{ minWidth: STICKY_COLUMN_MIN, repeat: "fit" }} gap={4}>
            {stickies.map((sticky, index) => (
              <StickyCard key={sticky.id} sticky={sticky} beforeId={stickies[index - 1]?.id ?? null} afterId={stickies[index + 1]?.id ?? null} />
            ))}
          </Grid>
        )}
      </VStack>
    </PanelPage>
  );
}
