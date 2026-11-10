"use client";

/**
 * An open chat (decision 146; docs/contracts/ui.md "Superagent chat"): the
 * header, the messages and the composer. A message goes out as a comment on
 * the work item, as a reply in the question's thread while the runner waits
 * for an answer. It shows on the right at once (useOptimistic) and is replaced
 * by the stored comment when the action's refresh arrives; a failure puts the
 * text back in the input. The chat's own scroller (ChatLayout, self-scrolling)
 * fills the pane under the header, so the composer stays docked at the bottom.
 */
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { ChatComposer, ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList, ChatMessageMetadata } from "@astryxdesign/core/Chat";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { createCommentAction } from "@/app/actions/relations-comments";
import { RequestDialogs, type RequestDialog } from "@/components/superagent/RequestDialogs";
import type { FailureContext } from "@/components/superagent/superagent-format";
import { composerStatus, entryName } from "@/components/superagent/chat-format";
import type { ChatOpen, SuperagentChatLoad } from "@/lib/superagent/types";
import { ChatEntryView } from "./ChatEntryView";
import { ConversationHeader } from "./ConversationHeader";

export type ConversationPaneProps = {
  open: ChatOpen;
  load: SuperagentChatLoad;
  /** Tells the screen a request dialog is open, which pauses its reload timer. */
  onDialogChange: (isOpen: boolean) => void;
  /** Tells the screen a message is being sent, which pauses its reload timer. */
  onSending: (isSending: boolean) => void;
};

type Pending = { id: number; text: string };

export function ConversationPane({ open, load, onDialogChange, onSending }: ConversationPaneProps) {
  if (open.kind === "not_found") {
    return (
      <VStack hAlign="center" vAlign="center" className="tessera-chat-pane tessera-chat-empty">
        <EmptyState title="No such work item" description={`${open.itemKey} does not exist or was deleted.`} headingLevel={2} />
      </VStack>
    );
  }
  return <ItemPane open={open} load={load} onDialogChange={onDialogChange} onSending={onSending} />;
}

function ItemPane({ open, load, onDialogChange, onSending }: ConversationPaneProps & { open: Extract<ChatOpen, { kind: "item" }> }) {
  const toast = useToast();
  const context: FailureContext = { tokenFile: load.tokenFile, runnerUrl: load.runnerUrl };
  const [text, setText] = useState("");
  const [dialog, setDialog] = useState<RequestDialog | null>(null);
  const [, startTransition] = useTransition();
  const [pending, addPending] = useOptimistic<Pending[], Pending>([], (held, added) => [...held, added]);
  const status = composerStatus(load.requests, context);
  const { replyToCommentId } = open;

  // A dialog still open when the chat changes or closes must not leave the reload timer paused.
  useEffect(() => () => onDialogChange(false), [onDialogChange]);
  const changeDialog = (next: RequestDialog | null) => {
    setDialog(next);
    onDialogChange(next !== null);
  };

  const send = (value: string) => {
    const body = value.trim();
    if (body === "") return;
    // The composer clears its own input after onSubmit; a failure puts the text back.
    startTransition(async () => {
      addPending({ id: Date.now(), text: body });
      onSending(true);
      try {
        const result = await createCommentAction({ work_item_id: open.workItemId, body_md: body, ...(replyToCommentId !== null ? { parent_comment_id: replyToCommentId } : {}) });
        if (!result.ok) {
          toast({ type: "error", body: `Could not send. ${result.message}` });
          setText((current) => (current === "" ? body : `${body}\n${current}`));
        }
      } finally {
        onSending(false);
      }
    });
  };

  const messages = [
    ...open.entries.map((entry) => (
      <ChatEntryView
        key={`entry-${entry.id}`}
        entry={entry}
        isMine={entry.actorId === load.userActorId}
        name={entryName(entry, load.superagentActorId)}
        projectId={open.projectId}
        mentionActors={open.mentionActors}
      />
    )),
    ...pending.map((message) => (
      <ChatMessage key={`pending-${message.id}`} sender="user">
        <ChatMessageBubble metadata={<ChatMessageMetadata status="sending" />}>
          <Text className="tessera-chat-pending">{message.text}</Text>
        </ChatMessageBubble>
      </ChatMessage>
    )),
  ];

  return (
    <VStack gap={0} className="tessera-chat-pane">
      <ConversationHeader open={open} load={load} onDialog={changeDialog} />
      <ChatLayout
        density="compact"
        className="tessera-chat-log"
        composer={
          <ChatComposer
            density="compact"
            value={text}
            onChange={setText}
            onSubmit={send}
            placeholder={open.isArchived ? "Archived work items take no comments." : "Message the superagent"}
            isDisabled={open.isArchived}
            headerContext={replyToCommentId !== null ? <Text type="supporting" color="secondary">Replies in the question&apos;s thread</Text> : undefined}
            status={status ?? undefined}
          />
        }
      >
        <ChatMessageList density="compact" emptyState={<EmptyState title="No messages yet" headingLevel={2} isCompact />}>
          {messages}
        </ChatMessageList>
      </ChatLayout>
      <RequestDialogs dialog={dialog} context={context} onClose={() => changeDialog(null)} />
    </VStack>
  );
}
