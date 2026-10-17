import { z } from "zod";
import { createComment, CreateCommentInput, deleteComment, listComments, updateComment, UpdateCommentInput } from "../../comments";
import { addReaction, ReactionInput, removeReaction } from "../../reactions";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";
import { deleted, toListResult } from "./shared";

const ListCommentsInput = z.object({ work_item_id: IdSchema.describe("Work item whose comments to list.") }).strict();

const CreateCommentToolInput = CreateCommentInput.extend({
  work_item_id: IdSchema.describe("Work item the comment is on."),
}).strict();

const UpdateCommentToolInput = UpdateCommentInput.extend({
  comment_id: IdSchema.describe("Comment to update."),
}).strict();

const DeleteCommentInput = z.object({ comment_id: IdSchema.describe("Comment to delete, together with its replies.") }).strict();

export const commentTools = [
  defineTool({
    name: "list_comments",
    title: "List comments",
    description: "Lists the live comments on a work item, roots oldest first, with one level of replies nested under each root.",
    input: ListCommentsInput,
    mutates: false,
    core: true,
    phase: "P7",
    run: (ctx, { work_item_id }) => toListResult(ctx, listComments(ctx, work_item_id)),
  }),
  defineTool({
    name: "create_comment",
    title: "Create comment",
    description:
      "Adds a markdown comment to a work item and subscribes the author. Threads are one level deep: a reply to a reply attaches to the root. Mention an actor as [@Name](actor:<id>), with ids from list_actors. Archived items are read-only (ARCHIVED).",
    input: CreateCommentToolInput,
    mutates: true,
    core: true,
    phase: "P7",
    run: (ctx, { work_item_id, body_md, parent_comment_id }) => createComment(ctx, work_item_id, { body_md, parent_comment_id }),
  }),
  defineTool({
    name: "update_comment",
    title: "Update comment",
    description:
      "Replaces a comment body. Only the author may edit (RULE otherwise). Pass expected_body_version from the comment; a stale version is CONFLICT and edited_at is set on success. Archived items are read-only (ARCHIVED).",
    input: UpdateCommentToolInput,
    mutates: true,
    phase: "P7",
    run: (ctx, { comment_id, body_md, expected_body_version }) => updateComment(ctx, comment_id, { body_md, expected_body_version }),
  }),
  defineTool({
    name: "delete_comment",
    title: "Delete comment",
    description: "Soft-deletes a comment and its replies. Allowed for the author and for the user. Archived items are read-only (ARCHIVED). Destructive.",
    input: DeleteCommentInput,
    mutates: true,
    destructive: true,
    phase: "P7",
    run: (ctx, { comment_id }) => {
      deleteComment(ctx, comment_id);
      return deleted(comment_id);
    },
  }),
  defineTool({
    name: "add_reaction",
    title: "Add reaction",
    description: "Adds one of 👍 👎 😄 🎉 😕 ❤️ 🚀 👀 on a work item or a comment. Adding the same reaction again is a no-op. Archived items are read-only (ARCHIVED).",
    input: ReactionInput,
    mutates: true,
    phase: "P7",
    run: (ctx, input) => addReaction(ctx, input),
  }),
  defineTool({
    name: "remove_reaction",
    title: "Remove reaction",
    description: "Removes the caller's reaction from a work item or a comment. Removing a reaction that is not there is a no-op.",
    input: ReactionInput,
    mutates: true,
    phase: "P7",
    run: (ctx, input) => removeReaction(ctx, input),
  }),
];
