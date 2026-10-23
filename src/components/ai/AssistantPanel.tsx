"use client";

/**
 * Assistant panel, the shell Layout's end slot (docs/drafts/p5-plan.md §6).
 * Width is stored (default 400, drag 320–640). Below 768px the panel covers
 * the content (ai-panel.css). The header names the project and, when a work
 * item is open, its key.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ChatComposer, ChatLayout } from "@astryxdesign/core/Chat";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { PanelBar, PanelHeader } from "@/components/shell/PanelHeader";
import { useCommandContext } from "@/components/shell/command-context";
import { useEntityLabels } from "@/components/shell/entity-labels";
import { AssistantIcon, XIcon } from "@/themes/catppuccin/icons";
import { assistantUnavailableCopy } from "./ai-status";
import { assistantHeading, composerPlaceholder, keyFromLabel, parseProjectIdentifier, scopeSuggestions } from "./assistant-scope";
import { DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH } from "./assistant-store";
import { AssistantTranscript } from "./AssistantTranscript";
import { useAssistantController } from "./AssistantProvider";
import { ConfirmApplyDialog } from "./ConfirmApplyDialog";

const TOKEN_SELECTOR = ".tessera-project-frame-token";

function useProjectIdentifier(pathname: string): string | null {
  const [identifier, setIdentifier] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const next = parseProjectIdentifier(document.querySelector(TOKEN_SELECTOR)?.textContent ?? null);
      setIdentifier((current) => (current === next ? current : next));
    };
    read();
    const root = document.querySelector(".tessera-panel");
    if (root === null) return;
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
  return identifier;
}

export function AssistantPanel() {
  const pathname = usePathname();
  const identifier = useProjectIdentifier(pathname);
  const command = useCommandContext();
  const labels = useEntityLabels();
  const assistant = useAssistantController();
  const [draft, setDraft] = useState("");
  const region = useResizable({
    defaultSize: DEFAULT_PANEL_WIDTH,
    minSize: MIN_PANEL_WIDTH,
    maxSize: MAX_PANEL_WIDTH,
    direction: "horizontal",
    onSizeChange: assistant.setWidth,
  });

  const appliedWidth = useRef(false);
  const { panelLoaded, width } = assistant;
  const { resize } = region;
  // `defaultSize` is read once. Apply the stored width after it loads.
  useEffect(() => {
    if (!panelLoaded || appliedWidth.current) return;
    appliedWidth.current = true;
    resize(width);
  }, [panelLoaded, resize, width]);

  const scope = assistant.scope;
  const openItem = command?.item ?? null;
  const workItemKey =
    scope.work_item_id === undefined
      ? null
      : openItem !== null && openItem.id === scope.work_item_id
        ? openItem.key
        : keyFromLabel(labels.get(scope.work_item_id));
  const heading = assistantHeading(identifier, workItemKey);
  const unavailable = assistant.status !== null && assistant.status.available === false ? assistantUnavailableCopy(assistant.status) : null;
  const streaming = assistant.conversation.turns.some((turn) => turn.streaming);
  const suggestions = scopeSuggestions(scope);
  const empty = assistant.conversation.turns.length === 0;

  return (
    <>
      <ResizeHandle className="tessera-ai-resize" resizable={region.props} direction="horizontal" isReversed hasDivider={false} label="Resize the assistant" />
      <LayoutPanel
        className="tessera-ai-panel"
        resizable={region.props}
        hasDivider
        padding={0}
        isScrollable={false}
        label="Assistant"
        role="complementary"
      >
        <Card padding={0} height="100%" className="tessera-ai-fill">
          <Layout
            height="fill"
            header={
              <VStack gap={0}>
                <PanelHeader label="Assistant">
                  <PanelBar
                    start={
                      <VStack gap={0}>
                        <Text weight="medium" maxLines={1}>
                          {heading.title}
                        </Text>
                        {heading.subtitle ? (
                          <Text type="supporting" color="secondary" maxLines={1}>
                            {heading.subtitle}
                          </Text>
                        ) : null}
                      </VStack>
                    }
                    end={
                      <>
                        <Button label="New conversation" size="sm" variant="ghost" onClick={assistant.newConversation} />
                        <IconButton label="Close" variant="ghost" size="sm" icon={<Icon icon={XIcon} />} onClick={assistant.close} />
                      </>
                    }
                  />
                </PanelHeader>
                {unavailable ? <Banner status="warning" title={unavailable.title} description={unavailable.description} /> : null}
              </VStack>
            }
            content={
              <LayoutContent padding={0} isScrollable={false}>
                <ChatLayout
                  className="tessera-ai-chat"
                  composer={
                    <ChatComposer
                      // Flat with a border: Astryx draws the control outline (--color-border-emphasized, 3:1 on the panel) and turns it accent on focus.
                      elevation="none"
                      value={draft}
                      onChange={setDraft}
                      onSubmit={(value) => {
                        const text = value.trim();
                        if (text === "") return;
                        setDraft("");
                        assistant.ask(text);
                      }}
                      onStop={assistant.stop}
                      isStopShown={streaming}
                      isDisabled={assistant.status?.available !== true}
                      placeholder={composerPlaceholder(scope)}
                      status={assistant.composerError ?? undefined}
                    />
                  }
                  emptyState={
                    empty ? (
                      <EmptyState
                        title="Ask the assistant"
                        icon={<Icon icon={AssistantIcon} />}
                        actions={
                          <VStack gap={2}>
                            {suggestions.map((suggestion) => (
                              <Button key={suggestion} label={suggestion} size="sm" variant="secondary" onClick={() => assistant.ask(suggestion)} />
                            ))}
                          </VStack>
                        }
                      />
                    ) : null
                  }
                >
                  {empty ? null : (
                    <AssistantTranscript
                      conversation={assistant.conversation}
                      onContinue={() => assistant.ask("Continue.")}
                      onApply={assistant.requestApply}
                      onDiscard={assistant.requestDiscard}
                      busyIds={assistant.busyIds}
                    />
                  )}
                </ChatLayout>
              </LayoutContent>
            }
          />
        </Card>
      </LayoutPanel>
      <ConfirmApplyDialog
        proposals={assistant.confirmProposals}
        isOpen={assistant.confirmOpen}
        isActionLoading={assistant.confirmLoading}
        onOpenChange={assistant.closeConfirm}
        onAction={assistant.confirmApply}
      />
    </>
  );
}
