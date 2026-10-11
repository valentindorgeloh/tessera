"use client";

/**
 * Shown instead of a cycles or modules screen while the project has the
 * feature turned off (docs/contracts/ui.md "Routes and data loading", feature
 * off). P3 has no settings UI, so there is no action button. A client
 * component because the Phosphor glyphs create a React context at module load.
 */
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Stack";
import { CycleIcon, ModuleIcon } from "@/themes/catppuccin/icons";

export type FeatureOffStateProps = { feature: "cycles" | "modules" };

export function FeatureOffState({ feature }: FeatureOffStateProps) {
  return (
    <VStack padding={8} hAlign="center" vAlign="center">
      <EmptyState
        icon={<Icon icon={feature === "cycles" ? CycleIcon : ModuleIcon} size="lg" color="secondary" />}
        title={feature === "cycles" ? "Cycles are turned off for this project" : "Modules are turned off for this project"}
        description="Project settings arrive in P4; an agent can turn them on with update_project_features."
      />
    </VStack>
  );
}
