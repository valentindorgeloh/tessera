"use client";

/** Agents (docs/drafts/p9-plan.md U3). A row opens that actor's profile. */
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, type TablePlugin } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { BAR_COLUMN, COUNT_COLUMN, NAME_COLUMN, TEXT_COLUMN } from "@/components/analytics/table-widths";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { ACCESS_LABEL, KIND_LABEL } from "@/components/profile/profile-format";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import type { AgentProfileRow, ProfileActor } from "@/lib/tessera/types";
import { RobotIcon } from "@/themes/catppuccin/icons";
import { Icon } from "@astryxdesign/core/Icon";

type Row = {
  id: string;
  /** The whole actor, for the avatar glyph. */
  actor: ProfileActor;
  name: string;
  kind: string;
  access: string;
  assignedOpen: number;
  lastActivityAt: string | null;
  activity7d: number;
};

export type AgentsScreenProps = { rows: AgentProfileRow[] };

export function AgentsScreen({ rows }: AgentsScreenProps) {
  const router = useRouter();
  const data: Row[] = rows.map((row) => ({
    id: row.actor.id,
    actor: row.actor,
    name: row.actor.name,
    kind: KIND_LABEL[row.actor.kind],
    access: ACCESS_LABEL[row.actor.access],
    assignedOpen: row.assigned_open,
    lastActivityAt: row.last_activity_at,
    activity7d: row.activity_7d,
  }));
  const open = useMemo<TablePlugin<Row>>(
    () => ({
      transformBodyRow: (props, row) => ({
        ...props,
        htmlProps: {
          ...props.htmlProps,
          className: "tessera-table-row",
          onClick: () => router.push(`/agents/${row.id}/summary`),
        },
      }),
    }),
    [router],
  );
  return (
    <PanelPage
      header={
        <PanelHeader label="Agents">
          <PanelBar start={<PanelTitle>Agents</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={4}>
        {rows.length === 0 ? (
          <EmptyState icon={<Icon icon={RobotIcon} size="lg" color="secondary" />} title="No agents" description="Assistant, system and connected agents show up here." />
        ) : (
          <Table<Row>
            density="compact"
            idKey="id"
            data={data}
            hasHover
            plugins={{ open }}
            columns={[
              {
                key: "name",
                header: "Name",
                width: NAME_COLUMN,
                renderCell: (row) => (
                  <HStack gap={2} vAlign="center">
                    <ActorAvatar actor={row.actor} size="sm" tooltip={false} />
                    <Link href={`/agents/${row.id}/summary`} className="tessera-profile-link" onClick={(event) => event.stopPropagation()}>
                      {row.name}
                    </Link>
                  </HStack>
                ),
              },
              {
                key: "kind",
                header: "Kind",
                width: TEXT_COLUMN,
                renderCell: (row) => <Text>{row.kind}</Text>,
              },
              {
                key: "access",
                header: "Access",
                width: TEXT_COLUMN,
                renderCell: (row) => <Text>{row.access}</Text>,
              },
              {
                key: "assigned",
                header: "Assigned open",
                width: COUNT_COLUMN,
                align: "end",
                renderCell: (row) => <Text hasTabularNumbers>{row.assignedOpen}</Text>,
              },
              {
                key: "last",
                header: "Last activity",
                width: TEXT_COLUMN,
                renderCell: (row) =>
                  row.lastActivityAt ? (
                    <RelativeTime value={row.lastActivityAt} type="supporting" color="secondary" hasTooltip={false} />
                  ) : (
                    <Text type="supporting" color="secondary">
                      Never
                    </Text>
                  ),
              },
              {
                key: "week",
                header: "Activity, 7 days",
                width: BAR_COLUMN,
                align: "end",
                renderCell: (row) => <Text hasTabularNumbers>{row.activity7d}</Text>,
              },
            ]}
          />
        )}
      </VStack>
    </PanelPage>
  );
}
