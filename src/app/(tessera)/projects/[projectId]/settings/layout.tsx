import { Suspense, type ReactNode } from "react";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { SettingsTabs } from "@/components/project-settings/SettingsTabs";
import { PanelBar, PanelHeader } from "@/components/shell/PanelHeader";

type Props = { children: ReactNode; params: Promise<{ projectId: string }> };

/**
 * Project settings frame (docs/drafts/p4-ui.md "Project settings (F2)"): a
 * panel header whose sub-header holds the General / Features / States / Labels /
 * Agents tabs, over the scrolling 960px reading column. No reads: the screens
 * take the project, states, labels and actors from the bundle the project
 * layout already loaded.
 */
export default function SettingsLayout({ children, params }: Props) {
  return (
    <Layout
      height="fill"
      header={
        <PanelHeader label="Settings">
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
          {/* ASSUMPTION: the 16px inline inset of panel rows (field guide) on the reading column. */}
          <VStack className="tessera-reading tessera-settings-body" gap={6} paddingInline={4}>
            {children}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

async function Tabs({ params }: Pick<Props, "params">) {
  const { projectId } = await params;
  return <SettingsTabs projectId={projectId} />;
}

function TabsSkeleton() {
  return (
    <HStack gap={4} vAlign="center">
      <Skeleton width={64} height={24} />
      <Skeleton width={64} height={24} index={1} />
      <Skeleton width={56} height={24} index={2} />
      <Skeleton width={56} height={24} index={3} />
      <Skeleton width={64} height={24} index={4} />
    </HStack>
  );
}
