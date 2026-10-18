"use client";

/**
 * Active cycles (docs/drafts/p9-plan.md U2): one section per cycle whose
 * dates include today, in project order, with the project's token and P3's
 * summary. Empty when no live project has a current cycle.
 */
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { ProjectToken } from "@/components/work-items/ProjectFrame";
import type { Logo } from "@/lib/tessera/types";
import { CycleIcon } from "@/themes/catppuccin/icons";
import { ActiveCycleSummary } from "./ActiveCycleSummary";
import type { CycleDetailData } from "./types";

export type ActiveCycleSection = {
  project: { id: string; name: string; identifier: string; logo: Logo | null };
  data: CycleDetailData;
};

export function ActiveCyclesScreen({ sections }: { sections: readonly ActiveCycleSection[] }) {
  return (
    <PanelPage
      header={
        <PanelHeader label="Active cycles">
          <PanelBar start={<PanelTitle>Active cycles</PanelTitle>} />
        </PanelHeader>
      }
    >
      {sections.length === 0 ? (
        <VStack padding={6}>
          <EmptyState
            title="No active cycles"
            description="Cycles whose dates include today show up here."
            icon={<CycleIcon />}
            headingLevel={2}
          />
        </VStack>
      ) : (
        <VStack gap={6} padding={6}>
          {sections.map((section) => (
            <VStack key={section.data.cycle.id} gap={3}>
              <HStack gap={2} vAlign="center">
                <ProjectToken project={section.project} size="sm" />
                <Link href={`/projects/${section.project.id}/work-items`} isStandalone>
                  {section.project.name}
                </Link>
              </HStack>
              <ActiveCycleSummary projectId={section.project.id} data={section.data} />
            </VStack>
          ))}
        </VStack>
      )}
    </PanelPage>
  );
}
