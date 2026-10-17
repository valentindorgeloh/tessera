import { Suspense, type ReactNode } from "react";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack } from "@astryxdesign/core/Stack";
import { ArchivesTabs } from "@/components/planning/ArchivesTabs";
import { PanelBar, PanelHeader } from "@/components/shell/PanelHeader";

type Props = { children: ReactNode; params: Promise<{ projectId: string }> };

/**
 * Project archives frame (docs/contracts/ui.md "Archives (E3)", "Shell" ›
 * "Panel headers"): a panel header whose sub-header holds the Work items /
 * Cycles / Modules tabs, over the scrolling archive list. No reads: the tabs
 * take the feature toggles from the project bundle the project layout
 * already loaded.
 */
export default function ArchivesLayout({ children, params }: Props) {
  return (
    <Layout
      height="fill"
      header={
        <PanelHeader label="Archives">
          <PanelBar
            size="subheader"
            start={
              <Suspense fallback={<TabsSkeleton />}>
                <Tabs params={params} />
              </Suspense>
            }
          />
        </PanelHeader>
      }
      content={
        <LayoutContent padding={0} isScrollable>
          {children}
        </LayoutContent>
      }
    />
  );
}

async function Tabs({ params }: Pick<Props, "params">) {
  const { projectId } = await params;
  return <ArchivesTabs projectId={projectId} />;
}

function TabsSkeleton() {
  return (
    <HStack gap={4} vAlign="center">
      <Skeleton width={88} height={24} />
      <Skeleton width={64} height={24} index={1} />
      <Skeleton width={72} height={24} index={2} />
    </HStack>
  );
}
