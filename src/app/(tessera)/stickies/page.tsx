import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import type { StickyView } from "@/components/home/home-format";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { StickiesScreen } from "@/components/stickies/StickiesScreen";
import { listStickies, readTessera } from "@/lib/tessera/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Stickies at `/stickies` (docs/drafts/p9-plan.md U1). `?q=` searches name and body. */
export default function StickiesPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<StickiesFallback />}>
      <StickiesBody searchParams={searchParams} />
    </Suspense>
  );
}

async function StickiesBody({ searchParams }: Props) {
  const params = await searchParams;
  await io();
  const q = typeof params.q === "string" ? params.q : "";
  const stickies: StickyView[] = await readTessera((ctx) => listStickies(ctx, q === "" ? {} : { q }));
  return <StickiesScreen stickies={stickies} q={q} />;
}

function StickiesFallback() {
  return (
    <PanelPage
      header={
        <PanelHeader label="Stickies">
          <PanelBar start={<PanelTitle>Stickies</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading stickies">
        <Skeleton height="var(--size-element-lg)" />
        <Skeleton height="var(--size-element-lg)" index={1} />
      </VStack>
    </PanelPage>
  );
}
