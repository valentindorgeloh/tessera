"use client";

/**
 * One sticky (docs/drafts/p9-plan.md U1). The body saves 800 ms after the
 * last edit and on blur. A later save wins. Delete asks first; moving
 * earlier or later does not.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { Card } from "@astryxdesign/core/Card";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteStickyAction, moveStickyAction, updateStickyAction } from "@/app/actions/stickies";
import { MarkdownEditor } from "@/components/editor";
import { PaletteColorSelector } from "@/components/project-settings/PaletteColorSelector";
import { AlertDialog } from "@/components/shell/dialogs";
import "@/components/styles/stickies.css";
import type { PaletteColor } from "@/lib/tessera/types";
import { stickyColorClass, stickyTitle, type StickyView } from "@/components/home/home-format";

export type StickyCardProps = {
  sticky: StickyView;
  beforeId: string | null;
  afterId: string | null;
};

const SAVE_DELAY_MS = 800;

export function StickyCard({ sticky, beforeId, afterId }: StickyCardProps) {
  const toast = useToast();
  const [name, setName] = useState(sticky.name);
  const [nameFrom, setNameFrom] = useState(sticky.name);
  const [color, setColor] = useState(sticky.color);
  const [colorFrom, setColorFrom] = useState(sticky.color);
  const [isDeleting, startDelete] = useTransition();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [, startMove] = useTransition();
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef(sticky.description_md);
  const lastSent = useRef(sticky.description_md);
  const idRef = useRef(sticky.id);
  const mounted = useRef(false);
  if (sticky.name !== nameFrom) {
    setNameFrom(sticky.name);
    if (name === nameFrom) setName(sticky.name);
  }
  if (sticky.color !== colorFrom) {
    setColorFrom(sticky.color);
    if (color === colorFrom) setColor(sticky.color);
  }

  const fail = (verb: string, message: string) => toast({ type: "error", body: `Could not ${verb} the sticky. ${message}` });

  const save = (patch: { name?: string; description_md?: string; color?: PaletteColor }) => {
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
      if (bodyRef.current === lastSent.current) return;
      lastSent.current = bodyRef.current;
      save({ description_md: bodyRef.current });
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
        if (markdown === lastSent.current) return;
        lastSent.current = markdown;
        void updateStickyAction({ sticky_id: stickyId, description_md: markdown });
      });
    };
  }, []);

  const commitName = () => {
    const next = name.trim();
    if (next === sticky.name) return;
    setName(next);
    save({ name: next });
  };

  const move = (placement: { before_id: string } | { after_id: string }) => {
    startMove(async () => {
      const result = await moveStickyAction({ sticky_id: sticky.id, ...placement });
      if (!result.ok) fail("move", result.message);
    });
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
    <Card id={sticky.id} padding={3} className={stickyColorClass(sticky.color)}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" hAlign="between">
          <TextInput
            label={`Name of ${title}`}
            isLabelHidden
            value={name}
            onChange={setName}
            onBlur={commitName}
            onEnter={commitName}
            placeholder="Untitled sticky"
            className="tessera-sticky-name"
          />
          <MoreMenu
            label={`Actions for ${title}`}
            size="sm"
            items={[
              { id: "earlier", label: "Move earlier", isDisabled: beforeId === null, onClick: () => beforeId !== null && move({ before_id: beforeId }) },
              { id: "later", label: "Move later", isDisabled: afterId === null, onClick: () => afterId !== null && move({ after_id: afterId }) },
              { id: "delete", label: "Delete", variant: "destructive", onClick: () => setDeleteOpen(true) },
            ]}
          />
        </HStack>
        <MarkdownEditor
          value={sticky.description_md}
          compact
          placeholder="Write a note."
          onChange={(markdown) => queueBody(markdown, SAVE_DELAY_MS)}
          onFlush={() => queueBody(bodyRef.current, 0)}
        />
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
