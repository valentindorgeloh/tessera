import { Suspense } from "react";
import { io } from "next/cache";
import { SuperagentChat } from "@/components/superagent/chat/SuperagentChat";
import { loadSuperagentChat } from "@/lib/superagent/chat";
import { ChatSkeleton } from "../skeleton";

type Props = { params: Promise<{ itemKey: string }> };

/**
 * `/agents/superagent/chat/<KEY>` (decision 146; docs/contracts/ui.md
 * "Superagent chat"): the chat list with that work item's conversation open.
 * An unknown key shows "No such work item" in the thread pane. The params are
 * awaited under Suspense, then `io()` before the reads.
 */
export default function SuperagentChatItemPage({ params }: Props) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatItemData params={params} />
    </Suspense>
  );
}

async function ChatItemData({ params }: Props) {
  const { itemKey } = await params;
  await io();
  const load = await loadSuperagentChat({ itemKey });
  return <SuperagentChat load={load} isNew={false} />;
}
