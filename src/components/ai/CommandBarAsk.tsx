"use client";

/**
 * Power K Ask handoff (docs/drafts/p5-plan.md §6 "U3", decision 38). The
 * palette lists the items from ./ask-items.ts; choosing one closes the
 * palette and `handoff` gives the question to the assistant panel. The
 * palette never chats. The Ask tab stays hidden while the status is
 * unavailable.
 */
import { useCallback } from "react";
import { useAssistant } from "@/components/ai/AssistantProvider";
import type { AiStatus } from "@/components/ai/ai-status";

export type CommandBarAskApi = {
  isAskShown: boolean;
  status: AiStatus | null;
  handoff: (text: string) => void;
};

export function useCommandBarAsk(): CommandBarAskApi {
  const assistant = useAssistant();
  const handoff = useCallback(
    (text: string) => {
      assistant.ask(text);
    },
    [assistant],
  );
  return { isAskShown: assistant.status?.available === true, status: assistant.status, handoff };
}
