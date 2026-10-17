"use client";

/**
 * Comment box (docs/drafts/p7-plan.md §6): the compact markdown editor, a
 * Comment button, and mod+enter to send. Editing the same box sends
 * `expected_body_version`; a CONFLICT shows "This comment changed" and
 * "Load theirs".
 *
 * ASSUMPTION: `createComment` and `updateComment` are not exported yet. The
 * wrappers in `src/app/actions/relations-comments.ts` keep those names and
 * answer UNAVAILABLE until `comments.ts` lands.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useToast } from "@astryxdesign/core/Toast";
import { createCommentAction, updateCommentAction } from "@/app/actions/relations-comments";
import { MarkdownEditor, type EntityLink, type MarkdownEditorHandle } from "@/components/editor";

export type CommentComposerProps = {
  workItemId: string;
  projectId: string | null;
  mentionActors: readonly { id: string; name: string }[];
  /** Set while editing an existing comment. */
  commentId?: string;
  expectedBodyVersion?: number;
  initialBody?: string;
  parentCommentId?: string;
  submitLabel?: string;
  onOpenEntity?: (link: EntityLink) => void;
  onDone?: () => void;
  onCancel?: () => void;
};

function conflictBody(details: unknown): string | null {
  if (typeof details !== "object" || details === null) return null;
  const body = (details as { body_md?: unknown }).body_md;
  return typeof body === "string" ? body : null;
}

export function CommentComposer({
  workItemId,
  projectId,
  mentionActors,
  commentId,
  expectedBodyVersion = 0,
  initialBody = "",
  parentCommentId,
  submitLabel = "Comment",
  onOpenEntity,
  onDone,
  onCancel,
}: CommentComposerProps) {
  const toast = useToast();
  const editor = useRef<MarkdownEditorHandle>(null);
  const root = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState(initialBody);
  const [generation, setGeneration] = useState(0);
  const [conflict, setConflict] = useState<{ body: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const submitRef = useRef<() => void>(() => {});

  const submit = () => {
    const body = (editor.current?.getMarkdown() ?? draft).trim();
    if (body === "" || pending) return;
    startTransition(async () => {
      const result =
        commentId === undefined
          ? await createCommentAction({
              work_item_id: workItemId,
              body_md: body,
              ...(parentCommentId !== undefined ? { parent_comment_id: parentCommentId } : {}),
            })
          : await updateCommentAction({ id: commentId, body_md: body, expected_body_version: expectedBodyVersion });
      if (result.ok) {
        setDraft("");
        setConflict(null);
        setGeneration((value) => value + 1);
        onDone?.();
        return;
      }
      if (result.code === "CONFLICT") {
        setConflict({ body: conflictBody(result.details) });
        return;
      }
      toast({ type: "error", body: `Could not comment: ${result.message}` });
    });
  };

  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submitRef.current();
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadTheirs = () => {
    if (conflict?.body == null) return;
    editor.current?.setMarkdown(conflict.body);
    setDraft(conflict.body);
    setConflict(null);
  };

  return (
    <VStack gap={2} ref={root} className="tessera-comment-composer">
      {conflict !== null ? (
        <Banner
          status="warning"
          title="This comment changed"
          description="Someone else saved this comment while you were editing."
          endContent={conflict.body !== null ? <Button variant="secondary" size="sm" label="Load theirs" onClick={loadTheirs} /> : undefined}
        />
      ) : null}
      <MarkdownEditor
        key={generation}
        ref={editor}
        value={generation === 0 ? initialBody : draft}
        onChange={setDraft}
        compact
        placeholder="Leave a comment…"
        mentionActors={mentionActors}
        projectId={projectId}
        onOpenEntity={onOpenEntity}
      />
      <HStack gap={2} hAlign="end">
        {onCancel ? <Button variant="ghost" size="sm" label="Cancel" onClick={onCancel} isDisabled={pending} /> : null}
        <Button variant="primary" size="sm" label={submitLabel} onClick={submit} isLoading={pending} />
      </HStack>
    </VStack>
  );
}
