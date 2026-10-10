"use server";

import type {Kind} from "../lib/workspace-model";
import {
  createNode,
  deleteNode,
  moveNode,
  updateNode,
} from "../lib/workspace";

export type ActionResult<T> = {ok: true; data: T} | {ok: false; error: string};

function fail(error: unknown): ActionResult<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Something went wrong.",
  };
}

export async function createNodeAction(input: {
  title: string;
  kind: Kind;
  parent: string | null;
  summary: string;
}): Promise<ActionResult<{id: string}>> {
  try {
    const node = await createNode(input);
    return {ok: true, data: {id: node.id}};
  } catch (error) {
    return fail(error);
  }
}

export async function updateNodeAction(
  id: string,
  patch: {title: string; summary: string; body: string},
): Promise<ActionResult<{id: string}>> {
  try {
    const node = await updateNode(id, patch);
    return {ok: true, data: {id: node.id}};
  } catch (error) {
    return fail(error);
  }
}

export async function moveNodeAction(
  id: string,
  parent: string | null,
): Promise<ActionResult<{id: string}>> {
  try {
    const node = await moveNode(id, parent);
    return {ok: true, data: {id: node.id}};
  } catch (error) {
    return fail(error);
  }
}

export async function deleteNodeAction(
  id: string,
): Promise<ActionResult<{id: string}>> {
  try {
    await deleteNode(id);
    return {ok: true, data: {id}};
  } catch (error) {
    return fail(error);
  }
}
