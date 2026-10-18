"use client";

/**
 * Workspace settings (docs/drafts/p9-plan.md U1): General (name) and AI
 * (model, effort, digests). Saves send only the field that changed.
 */
import { useState, useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Selector } from "@astryxdesign/core/Selector";
import { VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspace-settings";
import { assistantUnavailableCopy, useAiStatus } from "@/components/ai/AiStatusProvider";
import type { WorkspaceAiSettings } from "@/lib/tessera/types";
import { WorkspaceSettingsChrome } from "./WorkspaceSettingsChrome";
import { EFFORT_OPTIONS, EFFORT_UNSET, isAiEffort, workspaceNameError, type WorkspaceSettingsTab, type WorkspaceSettingsView } from "./settings-format";

export type WorkspaceSettingsScreenProps = {
  tab: WorkspaceSettingsTab;
  settings: WorkspaceSettingsView;
};

const EMPTY_AI: WorkspaceAiSettings = { model: null, effort: null, digest_enabled: true };

export function WorkspaceSettingsScreen({ tab, settings }: WorkspaceSettingsScreenProps) {
  return (
    <WorkspaceSettingsChrome tab={tab}>
      <VStack gap={6} padding={6}>
        {tab === "general" ? <GeneralPane name={settings.name} /> : <AiPane ai={settings.ai ?? EMPTY_AI} />}
      </VStack>
    </WorkspaceSettingsChrome>
  );
}

function GeneralPane({ name }: { name: string }) {
  const toast = useToast();
  const [draft, setDraft] = useState(name);
  const [fromServer, setFromServer] = useState(name);
  const [, startSave] = useTransition();
  if (name !== fromServer) {
    setFromServer(name);
    if (draft === fromServer) setDraft(name);
  }
  const error = workspaceNameError(draft);
  const commit = () => {
    const next = draft.trim();
    if (next === name || error !== null) return;
    setDraft(next);
    startSave(async () => {
      const result = await updateWorkspaceSettingsAction({ name: next });
      if (!result.ok) toast({ type: "error", body: `Could not rename the workspace. ${result.message}` });
    });
  };
  return (
    <FormLayout>
      <TextInput
        label="Workspace name"
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        onEnter={commit}
        status={error !== null && draft !== name ? { type: "error", message: error } : undefined}
      />
    </FormLayout>
  );
}

function AiPane({ ai }: { ai: WorkspaceAiSettings }) {
  const toast = useToast();
  const { status } = useAiStatus();
  const [model, setModel] = useState(ai.model ?? "");
  const [modelFrom, setModelFrom] = useState(ai.model ?? "");
  const [, startSave] = useTransition();
  if ((ai.model ?? "") !== modelFrom) {
    setModelFrom(ai.model ?? "");
    if (model === modelFrom) setModel(ai.model ?? "");
  }
  const unavailable = status !== null && status.available === false ? assistantUnavailableCopy(status) : null;
  const save = (patch: { model?: string | null; effort?: WorkspaceAiSettings["effort"]; digest_enabled?: boolean }) => {
    startSave(async () => {
      const result = await updateWorkspaceSettingsAction({ ai: patch });
      if (!result.ok) toast({ type: "error", body: `Could not save the assistant settings. ${result.message}` });
    });
  };
  const commitModel = () => {
    const next = model.trim();
    const stored = next === "" ? null : next;
    if (stored === ai.model) return;
    setModel(next);
    save({ model: stored });
  };
  return (
    <VStack gap={4}>
      {unavailable ? <Banner status="warning" title={unavailable.title} description={unavailable.description} /> : null}
      <FormLayout>
        <TextInput label="Model" value={model} onChange={setModel} onBlur={commitModel} onEnter={commitModel} placeholder="Default (env)" />
        <Selector
          label="Effort"
          options={EFFORT_OPTIONS}
          value={ai.effort ?? EFFORT_UNSET}
          onChange={(value) => {
            if (value === EFFORT_UNSET) {
              if (ai.effort !== null) save({ effort: null });
              return;
            }
            if (isAiEffort(value) && value !== ai.effort) save({ effort: value });
          }}
        />
        <Switch label="Digests and summaries" value={ai.digest_enabled} onChange={(enabled) => enabled !== ai.digest_enabled && save({ digest_enabled: enabled })} />
      </FormLayout>
    </VStack>
  );
}
