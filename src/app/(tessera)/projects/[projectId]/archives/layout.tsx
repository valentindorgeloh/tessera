import { Suspense, type ReactNode } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { ArchivesTabs } from "@/components/planning/ArchivesTabs";

type Props = { children: ReactNode; params: Promise<{ projectId: string }> };

/**
 * Project archives frame (docs/contracts/ui.md "Archives (E3)"): the Work
 * items / Cycles / Modules tabs above the archive list. No reads: the tabs
 * take the feature toggles from the project bundle the project layout
 * already loaded.
 */
export default function ArchivesLayout({ children, params }: Props) {
  return (
    <VStack gap={0} className="tessera-archives">
      <Suspense fallback={<TabsSkeleton />}>
        <Tabs params={params} />
      </Suspense>
      {children}
    </VStack>
  );
}

async function Tabs({ params }: Pick<Props, "params">) {
  const { projectId } = await params;
  return <ArchivesTabs projectId={projectId} />;
}

function TabsSkeleton() {
  return (
    <HStack gap={4} paddingInline={5} paddingBlock={2}>
      <Skeleton width={88} height={24} />
      <Skeleton width={64} height={24} index={1} />
      <Skeleton width={72} height={24} index={2} />
    </HStack>
  );
}
