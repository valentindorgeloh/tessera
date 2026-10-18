"use server";

/**
 * Relation and comment mutations. Comments map the composer's `id` onto the
 * registry's `comment_id`.
 */
import { toolAction } from "./_run";

export const addRelationAction = toolAction("add_relation");
export const removeRelationAction = toolAction("remove_relation");
export const createCommentAction = toolAction("create_comment");
export const addReactionAction = toolAction("add_reaction");
export const removeReactionAction = toolAction("remove_reaction");

const updateComment = toolAction("update_comment");
const deleteComment = toolAction("delete_comment");

export async function updateCommentAction(input: { id: string; body_md: string; expected_body_version: number }) {
  return updateComment({ comment_id: input.id, body_md: input.body_md, expected_body_version: input.expected_body_version });
}

export async function deleteCommentAction(input: { id: string }) {
  return deleteComment({ comment_id: input.id });
}
