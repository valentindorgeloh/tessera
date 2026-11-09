"use client";

/**
 * Agents tab of the project settings (docs/drafts/p4-ui.md "Agents"): the
 * intake policy switch, the project's default assignee and the list of actors
 * with an edit dialog for agents. Everything is disabled in an archived project.
 */
import { useRef, useState, useTransition } from "react";
import { notFound } from "next/navigation";
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
import { updateActorAction, updateProjectFeaturesAction } from "@/app/actions/settings";
import { failureText } from "@/components/planning/archive-rules";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { useOptionalProject } from "@/components/work-items/project-provider";
import type { ActorAccess, ActorRow } from "@/lib/tessera/types";
import { PencilIcon } from "@/themes/catppuccin/icons";
import { ActorDialog } from "./ActorDialog";
import { SettingsHelp, SettingsTitle } from "./SettingsRow";

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
        <Text type="supporting" color="secondary">
          Read-only agents can still read and manage their own inbox.
        </Text>
        <ActorList actors={actors} isArchived={isArchived} />
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
    <List hasDividers density="balanced" className="tessera-settings-list">
      <ListItem
        className="tessera-settings-row--wrap"
        label={<SettingsTitle>{label}</SettingsTitle>}
        description={<SettingsHelp>Work items created by MCP clients wait in Intake until you accept them.</SettingsHelp>}
        interactiveRef={rowRef}
        endContent={
          <Switch
            label={label}
            isLabelHidden
            size="sm"
            value={isOn}
            changeAction={change}
            isDisabled={isArchived || !isIntakeEnabled}
            disabledMessage={isArchived ? "Restore the project to change it" : "Turn on Intake first"}
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
      <List density="compact" hasDividers className="tessera-settings-list">
        {actors.map((actor) => (
          <ListItem
            key={actor.id}
            className="tessera-settings-row tessera-settings-row--wrap"
            // The name is in the row, so the avatar is not a second, focusable tooltip stop.
            startContent={<ActorAvatar actor={actor} size="sm" tooltip={false} />}
            label={<SettingsTitle>{actor.name}</SettingsTitle>}
            description={<SettingsHelp>{actorDescription(actor)}</SettingsHelp>}
            endContent={
              <HStack gap={2} vAlign="center" className="tessera-settings-end">
                <Token label={KIND_LABELS[actor.kind] ?? "Agent"} size="sm" />
                {actor.kind === "agent" ? <AccessSelect actor={actor} isArchived={isArchived} /> : null}
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

const ACCESS_OPTIONS: { value: ActorAccess; label: string }[] = [
  { value: "write", label: "Can write" },
  { value: "intake", label: "Intake only" },
  { value: "read", label: "Read only" },
];

function AccessSelect({ actor, isArchived }: { actor: ActorRow; isArchived: boolean }) {
  const toast = useToast();
  const [value, setValue] = useState<ActorAccess>(actor.access);
  const change = (next: string) => {
    const access = next as ActorAccess;
    const previous = value;
    setValue(access);
    void updateActorAction({ actor_id: actor.id, access }).then((result) => {
      if (!result.ok) {
        setValue(previous);
        toast({ type: "error", body: failureText("Could not change access", result.message) });
      }
    });
  };
  return <Selector label="Access" isLabelHidden size="sm" options={ACCESS_OPTIONS} value={value} onChange={change} isDisabled={isArchived} />;
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
