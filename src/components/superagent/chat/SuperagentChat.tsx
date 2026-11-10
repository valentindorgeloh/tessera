"use client";

/**
 * Superagent chat (decision 146; docs/contracts/ui.md "Superagent chat"): the
 * Inbox's frame with the chat list on the left and the open conversation, or
 * the new-chat pane, on the right. Under 1024px one pane shows at a time and
 * "All chats" leads back to the list. The page (server) loads everything in
 * one go; while the tab is visible and nothing is open or sending, the screen
 * asks Next to reload it every 5 seconds so runner stages stay current (the
 * agent's comments arrive through ChangesPoller).
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { HStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelTitle } from "@/components/shell/PanelHeader";
import { SUPERAGENT_CHAT_PATH, type SuperagentChatLoad } from "@/lib/superagent/types";
import { CaretLeftIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { useRunnerRefresh } from "../use-runner-refresh";
import { CHAT_REFRESH_INTERVAL_MS } from "../chat-format";
import { ConversationList } from "./ConversationList";
import { ConversationPane } from "./ConversationPane";
import { NewChatPane } from "./NewChatPane";

const LIST_MIN = 280;
const LIST_MAX = 520;
const LIST_DEFAULT = 360;

export type SuperagentChatProps = { load: SuperagentChatLoad; isNew: boolean };

export function SuperagentChat({ load, isNew }: SuperagentChatProps) {
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [isSending, setSending] = useState(false);
  const region = useResizable({ defaultSize: LIST_DEFAULT, minSize: LIST_MIN, maxSize: LIST_MAX, direction: "horizontal" });
  useRunnerRefresh(CHAT_REFRESH_INTERVAL_MS, isDialogOpen || isSending);
  const isOpen = load.open !== null || isNew;
  const cannotStart = load.superagentActorId === null || load.projects.length === 0;

  return (
    <Layout
      height="fill"
      className={isOpen ? "tessera-chat tessera-chat--open" : "tessera-chat"}
      header={
        <PanelHeader label="Superagent chat">
          <PanelBar
            start={<PanelTitle>Superagent chat</PanelTitle>}
            end={
              <>
                <Button variant="ghost" size="sm" label="Control screen" href="/agents/superagent" />
                <Button variant="primary" size="sm" label="New chat" icon={<PlusIcon />} href={`${SUPERAGENT_CHAT_PATH}?new=1`} isDisabled={cannotStart} />
              </>
            }
          />
        </PanelHeader>
      }
      start={
        <>
          <LayoutPanel className="tessera-chat-list" resizable={region.props} hasDivider padding={0} isScrollable label="Chats">
            <ConversationList load={load} />
          </LayoutPanel>
          <ResizeHandle resizable={region.props} direction="horizontal" hasDivider={false} label="Resize chats" />
        </>
      }
      content={
        <LayoutContent padding={0} className="tessera-chat-thread">
          {/* Below 1024px the thread replaces the list, so the way back is a button (superagent-chat.css hides it from 1024px up). */}
          <HStack paddingInline={4} paddingBlock={2} className="tessera-chat-back">
            <Button variant="ghost" size="sm" label="All chats" icon={<CaretLeftIcon />} href={SUPERAGENT_CHAT_PATH} />
          </HStack>
          {load.open !== null ? (
            <ConversationPane key={load.open.kind === "item" ? load.open.workItemId : load.open.itemKey} open={load.open} load={load} onDialogChange={setDialogOpen} onSending={setSending} />
          ) : (
            <NewChatPane load={load} onSending={setSending} />
          )}
        </LayoutContent>
      }
    />
  );
}
