"use client";

/**
 * One sticky (docs/drafts/p9-plan.md U1). The body saves 800 ms after the
 * last edit and on blur, without refreshing the page; a blur refreshes once
 * after it, so the home widget's preview catches up. A later save wins. Delete asks first; moving
 * earlier or later does not. The grip starts a pointer drag (the screen owns
 * the order, decision 105); the grip's arrow keys and the menu's Move earlier /
 * Move later are the keyboard path (decision 14).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { Card } from "@astryxdesign/core/Card";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { refreshAction } from "@/app/actions/shell";
import { deleteStickyAction, updateStickyAction, updateStickyBodyAction } from "@/app/actions/stickies";
import type { ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import { MarkdownEditor } from "@/components/editor";
import { PaletteColorSelector } from "@/components/project-settings/PaletteColorSelector";
import { AlertDialog } from "@/components/shell/dialogs";
import "@/components/styles/stickies.css";
import { DragHandleIcon } from "@/themes/catppuccin/icons";
import type { PaletteColor } from "@/lib/tessera/types";
import { stickyColorClass, stickyTitle, type StickyView } from "@/components/home/home-format";

export type StickyCardProps = {
  sticky: StickyView;
  /** Ref callback that registers the card with the screen's drag hook. */
  registerItem: (element: HTMLElement | null) => void;
  /** Pointer handlers of the grip. */
  handlers: ItemDragHandlers;
  /** Hidden in place while its clone follows the pointer. */
  isDragged: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  /** One place earlier (-1) or later (1); the screen applies it optimistically. */
  onStep: (direction: -1 | 1) => void;
};

const SAVE_DELAY_MS = 800;

/**
 * Body saves go through the quiet action, so the page does not re-render after
 * each one. `refreshIfSaved` (a flush) refreshes once when a save landed since
 * the last refresh, or right after the save still in flight.
 */
function createBodySaves() {
  let pending = 0;
  let unrefreshed = false;
  let wanted = false;
  const refreshIfSaved = () => {
    if (pending > 0) {
      wanted = true;
      return;
    }
    if (!unrefreshed) return;
    unrefreshed = false;
    wanted = false;
    void refreshAction();
  };
  const send = (stickyId: string, markdown: string, onFail: (message: string) => void) => {
    pending += 1;
    void updateStickyBodyAction({ sticky_id: stickyId, description_md: markdown }).then((result) => {
      pending -= 1;
      if (result.ok) unrefreshed = true;
      else onFail(result.message);
      if (pending === 0 && wanted) refreshIfSaved();
    });
  };
  return { send, refreshIfSaved };
}

export function StickyCard({ sticky, registerItem, handlers, isDragged, canMoveEarlier, canMoveLater, onStep }: StickyCardProps) {
  const toast = useToast();
  const [name, setName] = useState(sticky.name);
  const [nameFrom, setNameFrom] = useState(sticky.name);
  const [color, setColor] = useState(sticky.color);
  const [colorFrom, setColorFrom] = useState(sticky.color);
  const [isDeleting, startDelete] = useTransition();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef(sticky.description_md);
  const lastSent = useRef(sticky.description_md);
  const idRef = useRef(sticky.id);
  const mounted = useRef(false);
  const [bodySaves] = useState(createBodySaves);
  if (sticky.name !== nameFrom) {
    setNameFrom(sticky.name);
    if (name === nameFrom) setName(sticky.name);
  }
  if (sticky.color !== colorFrom) {
    setColorFrom(sticky.color);
    if (color === colorFrom) setColor(sticky.color);
  }

  const fail = (verb: string, message: string) => toast({ type: "error", body: `Could not ${verb} the sticky. ${message}` });

  const save = (patch: { name?: string; color?: PaletteColor }) => {
    const stickyId = idRef.current;
    void updateStickyAction({ sticky_id: stickyId, ...patch }).then((result) => {
      if (!result.ok) fail("save", result.message);
    });
  };

  const queueBody = (markdown: string, delay: number) => {
    bodyRef.current = markdown;
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
    bodyTimer.current = setTimeout(() => {
      bodyTimer.current = null;
      if (bodyRef.current !== lastSent.current) {
        lastSent.current = bodyRef.current;
        bodySaves.send(idRef.current, bodyRef.current, (message) => fail("save", message));
      }
      // A flush (blur, mod+s, Escape) is the delay-0 call: the debounced saves before it get their one refresh now.
      if (delay === 0) bodySaves.refreshIfSaved();
    }, delay);
  };

  useEffect(() => {
    idRef.current = sticky.id;
  }, [sticky.id]);

  useEffect(() => {
    if (bodyTimer.current !== null) return;
    if (bodyRef.current === lastSent.current) bodyRef.current = sticky.description_md;
    lastSent.current = sticky.description_md;
  }, [sticky.description_md]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const pending = bodyTimer.current !== null;
      const markdown = bodyRef.current;
      const stickyId = idRef.current;
      queueMicrotask(() => {
        if (mounted.current || !pending) return;
        if (bodyTimer.current) clearTimeout(bodyTimer.current);
        bodyTimer.current = null;
        if (markdown === lastSent.current) {
          // Nothing left to send, but the quiet saves that landed before still get their one refresh.
          bodySaves.refreshIfSaved();
          return;
        }
        lastSent.current = markdown;
        // Silent on failure, as before; the refresh follows the save.
        bodySaves.send(stickyId, markdown, () => {});
        bodySaves.refreshIfSaved();
      });
    };
  }, [bodySaves]);

  const commitName = () => {
    const next = name.trim();
    if (next === sticky.name) return;
    setName(next);
    save({ name: next });
  };

  const confirmDelete = () => {
    startDelete(async () => {
      const result = await deleteStickyAction({ sticky_id: sticky.id });
      if (!result.ok) {
        fail("delete", result.message);
        return;
      }
      setDeleteOpen(false);
    });
  };

  const title = stickyTitle(sticky.name);
  return (
    <Card ref={registerItem} id={sticky.id} padding={3} className={`${stickyColorClass(sticky.color)}${isDragged ? " tessera-sticky--dragging" : ""}`}>
      <VStack gap={3} className="tessera-sticky-content">
        <HStack gap={2} vAlign="center" hAlign="between">
          <IconButton
            label={`Reorder ${title}`}
            tooltip="Drag to reorder, or use the arrow keys"
            variant="ghost"
            size="sm"
            icon={<Icon icon={DragHandleIcon} />}
            className="tessera-sticky-grip"
            {...handlers}
            onKeyDown={(event) => {
              const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : null;
              if (direction === null || (direction < 0 ? !canMoveEarlier : !canMoveLater)) return;
              event.preventDefault();
              onStep(direction);
            }}
          />
          <TextInput
            label={`Name of ${title}`}
            isLabelHidden
            value={name}
            onChange={setName}
            onBlur={commitName}
            onEnter={commitName}
            placeholder="Untitled sticky"
            controlClassName="tessera-sticky-name"
          />
          <MoreMenu
            label={`Actions for ${title}`}
            size="sm"
            items={[
              { id: "earlier", label: "Move earlier", isDisabled: !canMoveEarlier, onClick: () => onStep(-1) },
              { id: "later", label: "Move later", isDisabled: !canMoveLater, onClick: () => onStep(1) },
              { id: "delete", label: "Delete", variant: "destructive", onClick: () => setDeleteOpen(true) },
            ]}
          />
        </HStack>
        {/* A long note scrolls inside the card, which is capped at 540px (stickies.css). */}
        <VStack className="tessera-sticky-body">
          <MarkdownEditor
            value={sticky.description_md}
            compact
            placeholder="Write a note."
            onChange={(markdown) => queueBody(markdown, SAVE_DELAY_MS)}
            onFlush={() => queueBody(bodyRef.current, 0)}
          />
        </VStack>
        <PaletteColorSelector
          label="Colour"
          size="sm"
          value={color}
          onChange={(next) => {
            setColor(next);
            if (next !== sticky.color) save({ color: next });
          }}
        />
      </VStack>
      <AlertDialog
        isOpen={isDeleteOpen}
        onOpenChange={(open) => !isDeleting && setDeleteOpen(open)}
        title={`Delete ${title}?`}
        description="This note is removed from the workspace."
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </Card>
  );
}
