"use client";

/**
 * The chat list (decision 152; docs/contracts/ui.md "Superagent chat"): one
 * row per work item the superagent works on with you (assigned, mentioned, or
 * with a runner request), newest activity first. A click opens that chat. The
 * rows come from Tessera, so the list works with the runner offline; the
 * runner's stage is added when its list loaded.
 */
import { useRouter } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { StageLabel } from "@/components/superagent/request-parts";
import { failureCopy } from "@/components/superagent/superagent-format";
import { chatHref, lastMessageLine } from "@/components/superagent/chat-format";
import type { SuperagentChatLoad } from "@/lib/superagent/types";

export function ConversationList({ load }: { load: SuperagentChatLoad }) {
  const router = useRouter();
  const openKey = load.open?.kind === "item" ? load.open.itemKey : null;
  const context = { tokenFile: load.tokenFile, runnerUrl: load.runnerUrl };
  return (
    <VStack gap={0}>
      {load.superagentActorId === null ? (
        <VStack padding={4}>
          <Banner status="info" title="The superagent hasn't connected yet" description="It shows up after the runner first connects to Tessera. New chats start once it has." />
        </VStack>
      ) : null}
      {!load.requests.ok ? (
        <VStack paddingInline={4} paddingBlock={2}>
          <Text type="supporting" color="secondary">
            {failureCopy(load.requests.failure, context).title}: stages and costs are hidden.
          </Text>
        </VStack>
      ) : null}
      <List aria-label="Chats" hasDividers>
        {load.conversations.length === 0 ? (
          <ListItem label="No chats yet" description="Start one, or assign or mention the superagent on a work item in a mapped project." />
        ) : (
          load.conversations.map((conversation) => (
            <ListItem
              key={conversation.workItemId}
              label={`${conversation.itemKey} ${conversation.title}`}
              description={lastMessageLine(conversation.lastMessage)}
              isSelected={conversation.itemKey === openKey}
              onClick={() => router.push(chatHref(conversation.itemKey))}
              endContent={
                <HStack gap={2} vAlign="center" className="tessera-chat-row-meta">
                  <RelativeTime value={conversation.lastActivityAt} type="supporting" color="secondary" hasTooltip={false} />
                  {conversation.request !== null ? <StageLabel stage={conversation.request.stage} /> : null}
                </HStack>
              }
            />
          ))
        )}
      </List>
    </VStack>
  );
}
