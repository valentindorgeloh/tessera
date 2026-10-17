"use client";

/**
 * Features tab of the project settings (docs/drafts/p4-ui.md "Features"): one
 * row per feature with a Switch. Cycles, Modules and Views toggle through
 * `updateProjectFeaturesAction`; turning one off hides its tab, Power K items
 * and options at once but keeps the data (decision 31). Pages, Intake and
 * Estimates arrive later: their Switch shows the stored value and stays
 * disabled with the reason.
 */
import { useRef } from "react";
import { notFound } from "next/navigation";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
import { useToast } from "@astryxdesign/core/Toast";
import { updateProjectFeaturesAction } from "@/app/actions/settings";
import { failureText } from "@/components/planning/archive-rules";
import { useOptionalProject } from "@/components/work-items/project-provider";
import type { Project } from "@/lib/tessera/types";
import { CycleIcon, IntakeIcon, ModuleIcon, PageIcon, SlidersIcon, ViewIcon } from "@/themes/catppuccin/icons";

type FeatureKey = "cycles_enabled" | "modules_enabled" | "views_enabled" | "pages_enabled" | "intake_enabled" | "estimates_enabled";

type FeatureRow = {
  key: FeatureKey;
  label: string;
  description: string;
  icon: typeof CycleIcon;
  /** Set for a feature that cannot be changed yet: why, and when it arrives. */
  unavailable?: string;
};

const FEATURES: readonly FeatureRow[] = [
  { key: "cycles_enabled", label: "Cycles", icon: CycleIcon, description: "Time-boxed iterations with burndown and burnup." },
  { key: "modules_enabled", label: "Modules", icon: ModuleIcon, description: "Group work items into larger pieces of work." },
  { key: "views_enabled", label: "Views", icon: ViewIcon, description: "Saved filters and display options." },
  { key: "pages_enabled", label: "Pages", icon: PageIcon, description: "Documents for the project.", unavailable: "Pages arrive in P6" },
  {
    key: "intake_enabled",
    label: "Intake",
    icon: IntakeIcon,
    description: "Review work items from agents before they enter the project.",
    unavailable: "Intake arrives in P8",
  },
  { key: "estimates_enabled", label: "Estimates", icon: SlidersIcon, description: "Points or sizes on work items.", unavailable: "Estimates arrive in P8" },
];

export function FeaturesSettings() {
  const context = useOptionalProject();
  // The project layout steps aside for an unknown id; the page is then the not-found screen.
  if (!context) notFound();
  const { project } = context.bundle;
  return (
    <List hasDividers density="balanced">
      {FEATURES.map((feature) => (
        <FeatureListItem key={feature.key} feature={feature} project={project} />
      ))}
    </List>
  );
}

function FeatureListItem({ feature, project }: { feature: FeatureRow; project: Project }) {
  const toast = useToast();
  const rowRef = useRef<HTMLInputElement>(null);
  const isArchived = project.archived_at !== null;
  const change = async (next: boolean) => {
    const result = await updateProjectFeaturesAction({ project_id: project.id, [feature.key]: next });
    // On a failure the project bundle is unchanged, so the Switch shows the saved value again.
    if (!result.ok) toast({ type: "error", body: failureText(`Could not change ${feature.label}`, result.message) });
  };
  return (
    <ListItem
      label={feature.label}
      description={feature.description}
      startContent={<Icon icon={feature.icon} size="sm" color="secondary" />}
      interactiveRef={rowRef}
      endContent={
        <Switch
          label={feature.label}
          isLabelHidden
          size="sm"
          value={project[feature.key]}
          changeAction={change}
          isDisabled={feature.unavailable !== undefined || isArchived}
          disabledMessage={feature.unavailable ?? "Restore the project to change it"}
          ref={rowRef}
        />
      }
    />
  );
}
