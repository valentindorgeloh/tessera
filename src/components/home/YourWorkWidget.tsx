"use client";

/** Your work numbers (docs/drafts/p9-plan.md U1), the same counts as the profile summary. */
import { Link } from "@astryxdesign/core/Link";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { stateGroupLabel, stateGroupVariant } from "@/components/work-items/properties/option-helpers";
import { StateGroupSchema } from "@/lib/tessera/schemas";
import type { YourWorkNumbers } from "./home-format";

export type YourWorkWidgetProps = { numbers: YourWorkNumbers };

type FigureKey = "assigned_open" | "assigned_overdue" | "assigned_due_this_week" | "created_open" | "subscribed_open";

const FIGURES: { key: FigureKey; label: string }[] = [
  { key: "assigned_open", label: "Assigned open" },
  { key: "assigned_overdue", label: "Overdue" },
  { key: "assigned_due_this_week", label: "Due this week" },
  { key: "created_open", label: "Created open" },
  { key: "subscribed_open", label: "Subscribed open" },
];

export function YourWorkWidget({ numbers }: YourWorkWidgetProps) {
  const groups = StateGroupSchema.options.filter((group) => group !== "triage" || (numbers.by_state_group[group] ?? 0) > 0);
  return (
    <VStack gap={3}>
      <Heading level={4} accessibilityLevel={2}>
        Your work
      </Heading>
      <MetadataList columns={3}>
        {FIGURES.map((figure) => (
          <MetadataListItem key={figure.key} label={figure.label}>
            <Text hasTabularNumbers>{numbers[figure.key]}</Text>
          </MetadataListItem>
        ))}
      </MetadataList>
      <HStack gap={3} wrap="wrap" className="tessera-home-groups">
        {groups.map((group) => (
          <HStack key={group} gap={1} vAlign="center">
            <StatusDot variant={stateGroupVariant(group)} label={stateGroupLabel(group)} />
            <Text type="supporting">{stateGroupLabel(group)}</Text>
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {numbers.by_state_group[group] ?? 0}
            </Text>
          </HStack>
        ))}
      </HStack>
      <Link href="/your-work/summary" className="tessera-home-open">
        Open Your work
      </Link>
    </VStack>
  );
}
