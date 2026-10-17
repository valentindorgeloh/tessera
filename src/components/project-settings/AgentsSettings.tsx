"use client";

/**
 * Agents tab of the project settings (docs/drafts/p4-ui.md "Agents"): the
 * intake policy switch, the project's default assignee and the list of actors
 * with an edit dialog for agents. Everything is disabled in an archived project.
 */
import { useRef, useState, useTransition } from "react";
import { notFound } from "next/navigation";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { updateProjectAction } from "@/app/actions/projects";
import { updateProjectFeaturesAction } from "@/app/actions/settings";
import { failureText } from "@/components/planning/archive-rules";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { useOptionalProject } from "@/components/work-items/project-provider";
import type { ActorRow } from "@/lib/tessera/types";
import { PencilIcon } from "@/themes/catppuccin/icons";
import { ActorDialog } from "./ActorDialog";

const NOBODY = "__none__";

export function AgentsSettings() {
  const context = useOptionalProject();
  // The project layout steps aside for an unknown id; the page is then the not-found screen.
  if (!context) notFound();
  const { bundle } = context;
  const { project } = bundle;
  const isArchived = project.archived_at !== null;
  const actors = bundle.actors.filter((actor) => actor.kind !== "system");

  return (
    <>
      <VStack gap={3}>
        <Heading level={5}>Intake policy</Heading>
        <IntakePolicy projectId={project.id} isOn={project.agent_intake_required} isIntakeEnabled={project.intake_enabled} isArchived={isArchived} />
      </VStack>
      {/* ASSUMPTION: the Selector's own label names this section, so it has no Heading of its own. */}
      <DefaultAssignee projectId={project.id} value={project.default_assignee_id} actors={actors} isArchived={isArchived} />
      <VStack gap={3}>
        <Heading level={5}>Actors</Heading>
        <ActorList actors={actors} isArchived={isArchived} />
        <Text type="supporting" color="secondary">
          Per-agent write permissions arrive in P8.
        </Text>
      </VStack>
    </>
  );
}

function IntakePolicy({ projectId, isOn, isIntakeEnabled, isArchived }: { projectId: string; isOn: boolean; isIntakeEnabled: boolean; isArchived: boolean }) {
  const toast = useToast();
  const rowRef = useRef<HTMLInputElement>(null);
  const label = "Agents submit through Intake";
  const change = async (next: boolean) => {
    const result = await updateProjectFeaturesAction({ project_id: projectId, agent_intake_required: next });
    if (!result.ok) toast({ type: "error", body: failureText(`Could not change ${label}`, result.message) });
  };
  return (
    <List hasDividers density="balanced">
      <ListItem
        label={label}
        description="Work items created by MCP clients wait in Intake until you accept them."
        interactiveRef={rowRef}
        endContent={
          <Switch
            label={label}
            isLabelHidden
            size="sm"
            value={isOn}
            changeAction={change}
            isDisabled={isArchived || !isIntakeEnabled}
            disabledMessage={isArchived ? "Restore the project to change it" : "Turn on Intake first (arrives in P8)"}
            ref={rowRef}
          />
        }
      />
    </List>
  );
}

function DefaultAssignee({ projectId, value, actors, isArchived }: { projectId: string; value: string | null; actors: ActorRow[]; isArchived: boolean }) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState(value ?? NOBODY);
  const options: SelectorOptionData[] = [{ value: NOBODY, label: "Nobody" }, ...actors.map((actor) => ({ value: actor.id, label: actor.name }))];

  const change = (next: string) => {
    const previous = selected;
    setSelected(next);
    startTransition(async () => {
      const result = await updateProjectAction({ project_id: projectId, default_assignee_id: next === NOBODY ? null : next });
      if (!result.ok) {
        setSelected(previous);
        toast({ type: "error", body: failureText("Could not change the default assignee", result.message) });
      }
    });
  };

  return (
    <Selector
      label="Default assignee"
      description="New work items without an assignee get this actor."
      options={options}
      value={selected}
      onChange={change}
      isDisabled={isArchived}
    />
  );
}

function ActorList({ actors, isArchived }: { actors: ActorRow[]; isArchived: boolean }) {
  const [editing, setEditing] = useState<ActorRow | null>(null);
  return (
    <>
      <List density="compact" hasDividers>
        {actors.map((actor) => (
          <ListItem
            key={actor.id}
            startContent={<Avatar name={actor.name} size="sm" />}
            label={actor.name}
            description={actorDescription(actor)}
            endContent={
              <HStack gap={2} vAlign="center">
                <Token label={KIND_LABELS[actor.kind] ?? "Agent"} size="sm" />
                {actor.kind === "agent" ? (
                  <MoreMenu
                    label={`Actions for ${actor.name}`}
                    size="sm"
                    alignment="end"
                    isDisabled={isArchived}
                    items={[{ id: "edit", label: "Edit…", icon: PencilIcon, onClick: () => setEditing(actor) }]}
                  />
                ) : null}
              </HStack>
            }
          />
        ))}
      </List>
      {editing ? <ActorDialog isOpen onOpenChange={(open) => !open && setEditing(null)} actor={editing} /> : null}
    </>
  );
}

const KIND_LABELS: Record<string, string> = { user: "You", assistant: "Assistant", agent: "Agent" };

function actorDescription(actor: ActorRow) {
  if (actor.kind === "user") return "You";
  if (actor.kind === "assistant") return "Built-in assistant";
  const client = actor.client_name ?? "MCP client";
  // ASSUMPTION: an agent that never connected reads "last active never".
  return actor.last_seen_at ? (
    <>
      {client} · last active <RelativeTime value={actor.last_seen_at} hasTooltip={false} />
    </>
  ) : (
    `${client} · last active never`
  );
}
