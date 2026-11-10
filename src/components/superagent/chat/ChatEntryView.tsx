"use client";

/**
 * One message of a chat (decision 153; docs/contracts/ui.md "Superagent chat"):
 * a work item's description or a comment, as a bubble. Yours sit on the right;
 * the superagent's and everyone else's on the left with their avatar and name.
 * The body is the comment renderer (read-only Markdown), so mentions and
 * entity links work as on the work item.
 */
import { useRouter } from "next/navigation";
import { ChatMessage, ChatMessageBubble, ChatMessageMetadata } from "@astryxdesign/core/Chat";
import { VStack } from "@astryxdesign/core/Stack";
import { useToast } from "@astryxdesign/core/Toast";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { entityRoute, MarkdownEditor, type EntityLink } from "@/components/editor";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import type { ChatEntry } from "@/lib/superagent/types";

export type ChatEntryViewProps = {
  entry: ChatEntry;
  isMine: boolean;
  /** `entryName(entry, superagentActorId)`; shown above a bubble on the left. */
  name: string;
  projectId: string;
  mentionActors: readonly { id: string; name: string }[];
};

/** "Description · In a thread · edited": whichever apply, or null. */
function footerOf(entry: ChatEntry): string | null {
  const parts = [entry.kind === "description" ? "Description" : null, entry.kind === "reply" ? "In a thread" : null, entry.isEdited ? "edited" : null].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function ChatEntryView({ entry, isMine, name, projectId, mentionActors }: ChatEntryViewProps) {
  const router = useRouter();
  const toast = useToast();
  // A work link goes through /browse/<KEY> (entityRoute); a link with no route here (a page) says so, as the work item's timeline does.
  const openEntity = (link: EntityLink) => {
    const route = entityRoute(link);
    if (route !== null) router.push(route);
    else toast({ type: "info", body: "That link is not a page in this workspace" });
  };
  return (
    <ChatMessage
      sender={isMine ? "user" : "assistant"}
      avatar={isMine ? undefined : <ActorAvatar actor={{ id: entry.actorId, name: entry.actorName, kind: entry.actorKind, color: entry.actorColor }} size="sm" />}
    >
      <ChatMessageBubble
        name={isMine ? undefined : name}
        metadata={<ChatMessageMetadata timestamp={<RelativeTime value={entry.createdAt} type="supporting" color="secondary" hasTooltip={false} />} footer={footerOf(entry)} />}
      >
        <VStack gap={0} className="tessera-chat-body">
          <MarkdownEditor value={entry.bodyMd} onChange={() => {}} readOnly compact projectId={projectId} mentionActors={mentionActors} onOpenEntity={openEntity} />
        </VStack>
      </ChatMessageBubble>
    </ChatMessage>
  );
}
