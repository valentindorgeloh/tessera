"use client";

/** Order and visibility of the five home widgets (docs/drafts/p9-plan.md U1). */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { useToast } from "@astryxdesign/core/Toast";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspace-settings";
import { HOME_WIDGET_LABELS, editableWidgets, moveWidget, type HomeWidgetSetting } from "./home-format";

export type ManageWidgetsDialogProps = {
  widgets: readonly { widget: string; enabled: boolean }[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export function ManageWidgetsDialog({ widgets, isOpen, onOpenChange }: ManageWidgetsDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={420} aria-label="Manage widgets">
      {isOpen ? <WidgetForm widgets={widgets} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function WidgetForm({ widgets, onOpenChange }: { widgets: readonly { widget: string; enabled: boolean }[]; onOpenChange: (isOpen: boolean) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<HomeWidgetSetting[]>(() => editableWidgets(widgets));
  const [isSaving, startSave] = useTransition();
  const move = (index: number, direction: -1 | 1) => setDraft((current) => moveWidget(current, index, direction));
  const toggle = (index: number, enabled: boolean) => setDraft((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled } : item)));
  const save = () => {
    if (isSaving) return;
    startSave(async () => {
      const result = await updateWorkspaceSettingsAction({ home_widgets: draft });
      if (!result.ok) {
        toast({ type: "error", body: `Could not save the widgets. ${result.message}` });
        return;
      }
      onOpenChange(false);
    });
  };
  return (
    <Layout
      header={<DialogHeader title="Manage widgets" onOpenChange={onOpenChange} />}
      content={
        <LayoutContent>
          <List hasDividers>
            {draft.map((item, index) => {
              const label = HOME_WIDGET_LABELS[item.widget];
              return (
                <ListItem
                  key={item.widget}
                  label={label}
                  endContent={
                    <HStack gap={2} vAlign="center">
                      <Switch label={`Show ${label}`} isLabelHidden size="sm" value={item.enabled} onChange={(enabled) => toggle(index, enabled)} />
                      <MoreMenu
                        label={`Reorder ${label}`}
                        size="sm"
                        items={[
                          { id: "up", label: "Move up", isDisabled: index === 0, onClick: () => move(index, -1) },
                          { id: "down", label: "Move down", isDisabled: index === draft.length - 1, onClick: () => move(index, 1) },
                        ]}
                      />
                    </HStack>
                  }
                />
              );
            })}
          </List>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isSaving} />
            <Button variant="primary" label="Save" onClick={save} isLoading={isSaving} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
