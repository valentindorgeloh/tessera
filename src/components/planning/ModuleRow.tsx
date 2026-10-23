"use client";

/**
 * One row of the modules list (docs/contracts/ui.md "Modules (E2)"): the
 * `ListItem` links to the module (its `href` renders an invisible anchor, so
 * the menu in `endContent` is a sibling, not nested). Status dot, name, status
 * and date range; at the end the lead, up to three members with a "+N"
 * overflow, "3/8" with a progress bar and the module menu.
 */
import { Avatar } from "@astryxdesign/core/Avatar";
import { AvatarGroup, AvatarGroupOverflow } from "@astryxdesign/core/AvatarGroup";
import { ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { HStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { useProject } from "@/components/work-items/project-provider";
import type { Module } from "@/lib/tessera/types";
import { ModuleMenu } from "./ModuleMenu";
import { MODULE_STATUS_LABEL, formatModuleRange, moduleProgressText, moduleProgressValues, moduleStatusVariant } from "./module-format";

export type ModuleRowProps = { projectId: string; module: Module };

/** Members shown before the "+N" overflow. */
const VISIBLE_MEMBERS = 3;

export function ModuleRow({ projectId, module }: ModuleRowProps) {
  const { actorsById, bundle } = useProject();
  const statusLabel = MODULE_STATUS_LABEL[module.status];
  const nameOf = (id: string) => actorsById.get(id)?.name ?? "Removed";
  const lead = module.lead_actor_id === null ? null : nameOf(module.lead_actor_id);
  const members = module.member_ids;
  const { value, max } = moduleProgressValues(module.progress);
  return (
    <ListItem
      className="tessera-modules-row tessera-row-hit"
      href={`/projects/${projectId}/modules/${module.id}`}
      startContent={<StatusDot variant={moduleStatusVariant(module.status)} label={statusLabel} />}
      label={
        <Text type="inherit" maxLines={1} className="tessera-modules-row-name">
          {module.name}
        </Text>
      }
      description={`${statusLabel} · ${formatModuleRange(module.start_date, module.target_date, bundle.today)}`}
      endContent={
        <HStack gap={4} vAlign="center" className="tessera-modules-row-end">
          {/* The lead and the members take fixed slots (an empty one stays), so every row's avatars start at the same x (visual audit P8). */}
          <HStack gap={2} vAlign="center">
            <HStack vAlign="center" className="tessera-modules-row-lead">
              {lead !== null ? <Avatar name={lead} size="sm" tooltip={`Lead: ${lead}`} /> : null}
            </HStack>
            <HStack vAlign="center" className="tessera-modules-row-members">
              {members.length > 0 ? (
                <AvatarGroup size="sm" aria-label={`Members: ${members.map(nameOf).join(", ")}`}>
                  {members.slice(0, VISIBLE_MEMBERS).map((id) => (
                    <Avatar key={id} name={nameOf(id)} tooltip={nameOf(id)} />
                  ))}
                  {members.length > VISIBLE_MEMBERS ? <AvatarGroupOverflow count={members.length - VISIBLE_MEMBERS} /> : null}
                </AvatarGroup>
              ) : null}
            </HStack>
          </HStack>
          <HStack gap={2} vAlign="center" className="tessera-modules-row-progress">
            <Text type="supporting" color="secondary" hasTabularNumbers className="tessera-modules-row-count">
              {moduleProgressText(module.progress)}
            </Text>
            {/* The "3/8" text next to it carries the value, so the success fill never stands alone (P3 trade-off). */}
            <ProgressBar label={`${module.name} progress`} isLabelHidden value={value} max={Math.max(max, 1)} variant="success" className="tessera-modules-row-bar" />
          </HStack>
          <ModuleMenu projectId={projectId} module={module} />
        </HStack>
      }
    />
  );
}
