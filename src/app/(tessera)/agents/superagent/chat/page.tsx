import { Suspense } from "react";
import { io } from "next/cache";
import { SuperagentChat } from "@/components/superagent/chat/SuperagentChat";
import { loadSuperagentChat } from "@/lib/superagent/chat";
import { ChatSkeleton } from "./skeleton";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * `/agents/superagent/chat` (decision 146; docs/contracts/ui.md "Superagent
 * chat"): the chat list with no conversation open, or the new-chat pane with
 * `?new=1`. A static segment, so it wins over `agents/[actorId]/[tab]`. The
 * search params are awaited under Suspense, then `io()` before the reads.
 */
export default function SuperagentChatPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatData searchParams={searchParams} />
    </Suspense>
  );
}

async function ChatData({ searchParams }: Props) {
  const params = await searchParams;
  await io();
  const load = await loadSuperagentChat({ itemKey: null });
  return <SuperagentChat load={load} isNew={params.new === "1"} />;
}
