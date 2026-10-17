"use client";

/**
 * The turns of one conversation (docs/drafts/p5-plan.md §6): a message per
 * turn, tool calls, notices, and the proposals that turn made. Continue
 * sends "Continue." when the answer was cut at max_tokens.
 */
import { Button } from "@astryxdesign/core/Button";
import { ChatMessage, ChatMessageBubble, ChatMessageList, ChatSystemMessage, ChatToolCalls } from "@astryxdesign/core/Chat";
import { Markdown } from "@astryxdesign/core/Markdown";
import { toolCallTitle, type Conversation } from "./assistant-store";
import { ProposalList } from "./ProposalList";

function toolLabel(count: number): string {
  return `Looked at ${count} ${count === 1 ? "thing" : "things"}`;
}

export function AssistantTranscript({
  conversation,
  onContinue,
  onApply,
  onDiscard,
  busyIds,
}: {
  conversation: Conversation;
  onContinue: () => void;
  onApply: (ids: string[]) => void;
  onDiscard: (ids: string[]) => void;
  busyIds: ReadonlySet<string>;
}) {
  const streaming = conversation.turns.some((turn) => turn.streaming);
  return (
    <ChatMessageList isStreaming={streaming} align="bottom">
      {conversation.turns.map((turn) => (
        <ChatMessage key={turn.id} sender={turn.role === "user" ? "user" : "assistant"}>
          {turn.notices.map((notice) => (
            <ChatSystemMessage key={`${turn.id}:${notice}`}>{notice}</ChatSystemMessage>
          ))}
          {turn.calls.length > 0 ? (
            <ChatToolCalls
              label={toolLabel(turn.calls.length)}
              calls={turn.calls.map((call) => ({
                key: call.id,
                name: toolCallTitle(call.name),
                status: call.status,
                target: call.summary === "" ? undefined : call.summary,
                errorMessage: call.status === "error" ? call.summary : undefined,
              }))}
            />
          ) : null}
          {turn.content !== "" || turn.streaming ? (
            <ChatMessageBubble>
              <Markdown density="compact" isStreaming={turn.streaming && turn.role === "assistant"}>
                {turn.content}
              </Markdown>
            </ChatMessageBubble>
          ) : null}
          <ProposalList proposals={turn.proposals} onApply={onApply} onDiscard={onDiscard} busyIds={busyIds} />
          {turn.canContinue ? <Button label="Continue" size="sm" variant="secondary" onClick={onContinue} /> : null}
        </ChatMessage>
      ))}
    </ChatMessageList>
  );
}
