"use client";

/**
 * The start of a chat (decision 146; docs/contracts/ui.md "Superagent chat"):
 * a composer and a project picker. The first message becomes a work item
 * assigned to the superagent, with the first line as its title and the whole
 * text as its description, and the screen moves to that item's chat. Without
 * the superagent's actor (the runner has not connected yet) or a mapped
 * project the composer is off and says why.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChatComposer, ChatLayout } from "@astryxdesign/core/Chat";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { Selector } from "@astryxdesign/core/Selector";
import { useToast } from "@astryxdesign/core/Toast";
import { createWorkItemAction } from "@/app/actions/work-items";
import { chatHref, chatTitle, composerStatus } from "@/components/superagent/chat-format";
import type { SuperagentChatLoad } from "@/lib/superagent/types";

export type NewChatPaneProps = {
  load: SuperagentChatLoad;
  /** Tells the screen a chat is being created, which pauses its reload timer. */
  onSending: (isSending: boolean) => void;
};

export function NewChatPane({ load, onSending }: NewChatPaneProps) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { superagentActorId, projects } = load;
  // The pick survives a reload that still lists it; otherwise the first project.
  const selected = projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const isOff = superagentActorId === null || selected === null;
  const status = composerStatus(load.requests, { tokenFile: load.tokenFile, runnerUrl: load.runnerUrl });
  const placeholder =
    superagentActorId === null ? "The superagent hasn't connected yet." : selected === null ? "Map a project to a repository first." : "What should the superagent do?";

  const start = (value: string) => {
    const body = value.trim();
    if (body === "" || isOff || isPending) return;
    startTransition(async () => {
      onSending(true);
      try {
        const result = await createWorkItemAction({ project_id: selected.id, name: chatTitle(body), description_md: body, assignee_ids: [superagentActorId] });
        if (!result.ok) {
          // The composer clears its own input after onSubmit; a failure puts the text back.
          toast({ type: "error", body: `Could not start the chat. ${result.message}` });
          setText(body);
          return;
        }
        router.push(chatHref(result.data.key));
      } finally {
        onSending(false);
      }
    });
  };

  return (
    <ChatLayout
      density="compact"
      className="tessera-chat-pane tessera-chat-log"
      emptyState={<EmptyState title="Start a chat" description="Pick a project and say what you need. The superagent gets it as a new work item." headingLevel={2} />}
      composer={
        <ChatComposer
          density="compact"
          value={text}
          onChange={setText}
          onSubmit={start}
          placeholder={placeholder}
          isDisabled={isOff || isPending}
          status={status ?? undefined}
          footerActions={
            projects.length === 0 ? (
              <Link href="/agents/superagent">Open settings</Link>
            ) : (
              <Selector
                label="Project"
                isLabelHidden
                size="sm"
                value={selected?.id}
                onChange={setProjectId}
                isDisabled={isPending}
                options={projects.map((project) => ({ value: project.id, label: project.name, description: project.repo }))}
              />
            )
          }
        />
      }
    >
      {null}
    </ChatLayout>
  );
}
