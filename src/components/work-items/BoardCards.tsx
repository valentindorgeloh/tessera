"use client";

/**
 * Board cards: the draggable card with its "Move to" menu, the card body shared
 * with the drag overlay, and the compact property tokens. Split out of
 * BoardLayout.tsx; pure functions of their props.
 */

import type { ReactNode } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { AvatarGroup } from "@astryxdesign/core/AvatarGroup";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import type { ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import type { DisplayProperties, WorkItem } from "@/lib/tessera/types";
import { PriorityLabel, StateLabel, paletteTokenColor } from "./properties";
import type { ProjectBundle } from "./types";

export function BoardCard({
  item,
  bundle,
  properties,
  columns,
  currentColumn,
  cardRef,
  handlers,
  onOpen,
  onMoveTo,
}: {
  item: WorkItem;
  bundle: ProjectBundle;
  properties: DisplayProperties;
  /** "Move to" targets; empty when the grouped field cannot be moved between. */
  columns: { id: string; name: string }[];
  currentColumn: string;
  /** Absent when the board is read-only: the card is not a drag source. */
  cardRef?: (el: HTMLDivElement | null) => void;
  handlers?: ItemDragHandlers;
  onOpen: (id: string) => void;
  onMoveTo: (itemId: string, fromColumn: string, toColumn: string) => void;
}) {
  const targets = columns.filter((column) => column.id !== currentColumn);
  const menu = (
    <MoreMenu
      label={`Actions for ${item.key}`}
      size="sm"
      alignment="end"
      items={[
        { id: "open", label: "Open", onClick: () => onOpen(item.id) },
        ...(targets.length > 0
          ? [
              { type: "divider" as const },
              {
                id: "move",
                label: "Move to",
                items: targets.map((column) => ({ id: column.id, label: column.name, onClick: () => onMoveTo(item.id, currentColumn, column.id) })),
              },
            ]
          : []),
      ]}
    />
  );
  return (
    <ClickableCard
      ref={cardRef}
      label={`${item.key} ${item.name}`}
      padding={3}
      className={handlers ? "tessera-board-card" : "tessera-board-card tessera-board-card-readonly"}
      onClick={() => onOpen(item.id)}
      onPointerDown={handlers?.onPointerDown}
      onClickCapture={handlers?.onClickCapture}
    >
      <BoardCardBody item={item} bundle={bundle} properties={properties} menu={menu} />
    </ClickableCard>
  );
}

/** Card contents, shared by the column card and the drag overlay clone so both stay identical. */
export function BoardCardBody({ item, bundle, properties, menu }: { item: WorkItem; bundle: ProjectBundle; properties: DisplayProperties; menu: ReactNode }) {
  return (
    <VStack gap={2}>
      <HStack hAlign="between" vAlign="center" gap={2}>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {properties.key ? item.key : ""}
        </Text>
        {menu}
      </HStack>
      <Text weight="medium" maxLines={3}>
        {item.name}
      </Text>
      <CardProperties item={item} bundle={bundle} properties={properties} />
    </VStack>
  );
}

/** Compact property tokens enabled in display.properties. */
function CardProperties({ item, bundle, properties }: { item: WorkItem; bundle: ProjectBundle; properties: DisplayProperties }) {
  const state = properties.state ? bundle.states.find((candidate) => candidate.id === item.state_id) : undefined;
  const labels = properties.labels ? bundle.labels.filter((label) => item.label_ids.includes(label.id)) : [];
  const modules = properties.modules ? bundle.modules.filter((module) => item.module_ids.includes(module.id)) : [];
  const cycle = properties.cycle && item.cycle_id !== null ? bundle.cycles.find((candidate) => candidate.id === item.cycle_id) : undefined;
  const assignees = properties.assignees ? bundle.actors.filter((actor) => item.assignee_ids.includes(actor.id)) : [];
  const showPriority = properties.priority && item.priority !== "none";
  const estimatePoint =
    properties.estimate && item.estimate_point_id !== null && bundle.estimate !== null
      ? bundle.estimate.points.find((point) => point.id === item.estimate_point_id)
      : undefined;
  const dates: string[] = [];
  if (properties.start_date && item.start_date !== null) dates.push(`Start ${item.start_date}`);
  if (properties.target_date && item.target_date !== null) dates.push(`Due ${item.target_date}`);
  const counts: string[] = [];
  if (properties.sub_items_count && item.sub_items_count > 0) counts.push(item.sub_items_count === 1 ? "1 sub-item" : `${item.sub_items_count} sub-items`);
  if (properties.links && item.links_count > 0) counts.push(item.links_count === 1 ? "1 link" : `${item.links_count} links`);
  if (properties.created_at) counts.push(`Created ${item.created_at.slice(0, 10)}`);
  if (properties.updated_at) counts.push(`Updated ${item.updated_at.slice(0, 10)}`);

  const hasTokens = state !== undefined || showPriority || labels.length > 0 || modules.length > 0 || cycle !== undefined || assignees.length > 0 || estimatePoint !== undefined;
  if (!hasTokens && dates.length === 0 && counts.length === 0) return null;

  return (
    <VStack gap={1}>
      {hasTokens ? (
        <HStack gap={1.5} vAlign="center" wrap="wrap">
          {state ? (
            <Text type="supporting" color="secondary">
              <StateLabel state={state} />
            </Text>
          ) : null}
          {showPriority ? (
            <Text type="supporting" color="secondary">
              <PriorityLabel value={item.priority} />
            </Text>
          ) : null}
          {labels.map((label) => (
            <Token key={label.id} size="sm" label={label.name} color={paletteTokenColor(label.color)} />
          ))}
          {cycle ? <Token key={cycle.id} size="sm" label={cycle.name} /> : null}
          {estimatePoint !== undefined && bundle.estimate !== null ? <Token size="sm" label={formatEstimateValue(bundle.estimate.type, estimatePoint.value)} /> : null}
          {modules.map((module) => (
            <Token key={module.id} size="sm" label={module.name} />
          ))}
          {assignees.length > 0 ? (
            <AvatarGroup size="xsm">
              {assignees.map((actor) => (
                <Avatar key={actor.id} name={actor.name} size="xsm" tooltip={actor.name} />
              ))}
            </AvatarGroup>
          ) : null}
        </HStack>
      ) : null}
      {dates.length > 0 ? (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {dates.join(" · ")}
        </Text>
      ) : null}
      {counts.length > 0 ? (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {counts.join(" · ")}
        </Text>
      ) : null}
    </VStack>
  );
}
