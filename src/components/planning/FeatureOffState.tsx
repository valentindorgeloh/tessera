"use client";

/**
 * Shown instead of a cycles, modules or views screen while the project has the
 * feature turned off (docs/contracts/ui.md "Routes and data loading", feature
 * off; decision 31). The button opens Settings › Features. A client component
 * because the Phosphor glyphs create a React context at module load.
 */
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Stack";
import { CycleIcon, ModuleIcon, PageIcon, ViewIcon } from "@/themes/catppuccin/icons";

export type FeatureOffStateProps = { feature: "cycles" | "modules" | "views" | "pages"; projectId: string };

const FEATURES = {
  cycles: { icon: CycleIcon, title: "Cycles are turned off for this project" },
  modules: { icon: ModuleIcon, title: "Modules are turned off for this project" },
  views: { icon: ViewIcon, title: "Views are turned off for this project" },
  pages: { icon: PageIcon, title: "Pages are turned off for this project" },
} as const;

export function FeatureOffState({ feature, projectId }: FeatureOffStateProps) {
  const { icon, title } = FEATURES[feature];
  return (
    <VStack padding={8} hAlign="center" vAlign="center">
      <EmptyState
        icon={<Icon icon={icon} size="lg" color="secondary" />}
        title={title}
        description="Turn them on in Settings › Features."
        actions={<Button variant="secondary" size="sm" label="Open Features settings" href={`/projects/${projectId}/settings/features`} />}
      />
    </VStack>
  );
}
