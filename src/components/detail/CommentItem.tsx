"use client";

/**
 * One comment on the timeline (docs/drafts/p7-plan.md §6): actor, time,
 * "edited", the markdown body, and a menu for reply, edit, copy link and
 * delete. Replies indent under the root. A reply to a reply stays on the root.
 *
 * ASSUMPTION: `CommentView` is not exported from `@/lib/tessera/types` yet
 * (`comments.ts` is absent). This is the planned shape: the comment row plus
 * the actor, reactions and nested replies. `ReactionBar` is not in the tree
 * yet, so this row does not render reactions.
 */
import { useState, useTransition } from "react";
import { AlertDialog } from "@/components/shell/dialogs";
import { Avatar } from "@astryxdesign/core/Avatar";
import type { DropdownMenuItemData } from "@astryxdesign/core/DropdownMenu";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { useClipboard } from "@astryxdesign/core/hooks";
import { deleteCommentAction } from "@/app/actions/relations-comments";
import { MarkdownEditor, type EntityLink } from "@/components/editor";
import type { ActorKind, CommentRow } from "@/lib/tessera/types";
import { CopyIcon, PencilIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { CommentComposer } from "./CommentComposer";
import { RelativeTime } from "./RelativeTime";

export type ReactionSummary = { reaction: string; count: number; actor_ids: string[] };

export type CommentView = CommentRow & {
  actor_name: string;
  actor_kind: ActorKind | null;
  reactions: ReactionSummary[];
  replies: CommentView[];
};

export type CommentItemProps = {
  comment: CommentView;
  /** The thread root. A reply's own reply attaches here, not to itself. */
  rootId: string;
  workItemId: string;
  projectId: string | null;
  readOnly: boolean;
  currentActorId: string;
  mentionActors: readonly { id: string; name: string }[];
  onOpenEntity?: (link: EntityLink) => void;
};

function commentLink(id: string): string {
  if (typeof window === "undefined") return `#comment-${id}`;
  const url = new URL(window.location.href);
  url.hash = `comment-${id}`;
  return url.toString();
}

export function CommentItem({ comment, rootId, workItemId, projectId, readOnly, currentActorId, mentionActors, onOpenEntity }: CommentItemProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, startDeleting] = useTransition();
  const clipboard = useClipboard({ announce: "Copied" });
  const canEdit = !readOnly && comment.actor_id === currentActorId;
  const replies = comment.replies;
  const items: DropdownMenuItemData[] = [];
  if (!readOnly) items.push({ id: "reply", label: "Reply", onClick: () => setReplying(true) });
  if (canEdit) items.push({ id: "edit", label: "Edit", icon: PencilIcon, onClick: () => setEditing(true) });
  items.push({ id: "copy", label: "Copy link", icon: CopyIcon, onClick: () => void clipboard.copy(commentLink(comment.id)) });
  if (!readOnly) items.push({ id: "delete", label: "Delete", icon: TrashIcon, variant: "destructive", onClick: () => setConfirmDelete(true) });

  const remove = () => {
    startDeleting(async () => {
      const result = await deleteCommentAction({ id: comment.id });
      if (!result.ok) toast({ type: "error", body: `Could not delete the comment: ${result.message}` });
    });
  };

  return (
    <VStack gap={2} id={`comment-${comment.id}`} className="tessera-comment" as="li">
      <HStack gap={2} vAlign="center">
        <Avatar name={comment.actor_name} size="sm" />
        <Text type="supporting" weight="medium">
          {comment.actor_name}
        </Text>
        <RelativeTime value={comment.created_at} type="supporting" color="secondary" />
        {comment.edited_at !== null ? (
          <Text type="supporting" color="secondary">
            edited
          </Text>
        ) : null}
        <MoreMenu label={`Actions for the comment by ${comment.actor_name}`} size="sm" items={items} />
      </HStack>
      {editing ? (
        <CommentComposer
          workItemId={workItemId}
          projectId={projectId}
          mentionActors={mentionActors}
          initialBody={comment.body_md}
          commentId={comment.id}
          expectedBodyVersion={comment.body_version}
          submitLabel="Save"
          onOpenEntity={onOpenEntity}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <VStack gap={0} className="tessera-comment-body">
          <MarkdownEditor value={comment.body_md} onChange={() => {}} readOnly compact projectId={projectId} mentionActors={mentionActors} onOpenEntity={onOpenEntity} />
        </VStack>
      )}
      {replying ? (
        <CommentComposer
          workItemId={workItemId}
          projectId={projectId}
          mentionActors={mentionActors}
          parentCommentId={rootId}
          submitLabel="Reply"
          onOpenEntity={onOpenEntity}
          onDone={() => setReplying(false)}
          onCancel={() => setReplying(false)}
        />
      ) : null}
      {replies.length > 0 ? (
        <VStack gap={2} as="ul" aria-label="Replies" className="tessera-comment-replies">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              rootId={rootId}
              workItemId={workItemId}
              projectId={projectId}
              readOnly={readOnly}
              currentActorId={currentActorId}
              mentionActors={mentionActors}
              onOpenEntity={onOpenEntity}
            />
          ))}
        </VStack>
      ) : null}
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this comment?"
        description={
          replies.length === 0
            ? "The comment is deleted."
            : `The comment and its ${replies.length} ${replies.length === 1 ? "reply" : "replies"} are deleted.`
        }
        actionLabel="Delete"
        actionVariant="destructive"
        onAction={remove}
      />
    </VStack>
  );
}
