"use client";

/**
 * Order and visibility of the five home widgets (docs/drafts/p9-plan.md U1).
 * A row drags to a new slot with the pointer (decision 105); "Reorder <widget>"
 * keeps Move up / Move down as the keyboard path (decision 14); the grip is the
 * touch handle, a 44px target at coarse pointers, so a finger elsewhere on a
 * row still scrolls. The list is a draft until Save, so a drop only edits the
 * draft and a failed save keeps it open with a toast.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { useToast } from "@astryxdesign/core/Toast";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspace-settings";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import { dropMarker, reorderBy } from "@/components/stickies/reorder-math";
import { DragHandleIcon } from "@/themes/catppuccin/icons";
import { HOME_WIDGET_LABELS, editableWidgets, moveWidget, type HomeWidgetSetting } from "./home-format";

const WIDGET_CONTAINER = "widgets";
/** The dialog itself is not an ignored ancestor here, so the usual role="dialog" guard is left out. */
const DRAG_IGNORE = 'button, a, input, textarea, select, label, [role="switch"], [role="menuitem"], [role="menu"]';

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
  const ids = draft.map((item) => item.widget);
  const { drag, registerContainer, registerItem, itemHandlers } = usePointerDrag({
    onDrop: (event: DragDropEvent) => setDraft((current) => reorderBy(current, (item) => item.widget, event.id, event.index)),
    itemsOf: () => ids,
    ignoreSelector: DRAG_IGNORE,
  });
  const marker = drag?.target ? dropMarker(ids, drag.id, drag.target.index) : null;
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
          <List ref={registerContainer(WIDGET_CONTAINER)} hasDividers>
            {draft.map((item, index) => {
              const label = HOME_WIDGET_LABELS[item.widget];
              return (
                <ListItem
                  key={item.widget}
                  ref={registerItem(item.widget)}
                  {...itemHandlers(item.widget, WIDGET_CONTAINER)}
                  className={rowClass(item.widget, drag?.id ?? null, marker)}
                  label={label}
                  startContent={
                    <HStack hAlign="center" vAlign="center" className="tessera-widget-grip">
                      <Icon icon={DragHandleIcon} size="sm" color="secondary" />
                    </HStack>
                  }
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

function rowClass(widget: string, draggedId: string | null, marker: { id: string; edge: "before" | "after" } | null): string {
  const classes = ["tessera-widget-row"];
  if (widget === draggedId) classes.push("tessera-widget-row--dragging");
  if (marker !== null && marker.id === widget) classes.push(`tessera-widget-row--${marker.edge}`);
  return classes.join(" ");
}
