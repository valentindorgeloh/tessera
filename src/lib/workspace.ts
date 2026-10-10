import "server-only";

import {mkdir, readdir, readFile, unlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {revalidatePath} from "next/cache";
import {
  childrenOf,
  descendantsOf,
  isNodeId,
  parseNode,
  searchNodes,
  serializeNode,
  slugify,
  type Kind,
  type SearchHit,
  type WorkspaceNode,
} from "./workspace-model";

const CONTENT_DIR = path.join(process.cwd(), "content");

let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function listNodes(): Promise<WorkspaceNode[]> {
  await mkdir(CONTENT_DIR, {recursive: true});
  const names = await readdir(CONTENT_DIR);
  const nodes = await Promise.all(
    names
      .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
      .map(async (name) => {
        const text = await readFile(path.join(CONTENT_DIR, name), "utf8");
        const node = parseNode(text);
        const expected = `${node.id}.md`;
        if (name !== expected) {
          throw new Error(`File ${name} does not match id ${node.id}.`);
        }
        return node;
      }),
  );
  return nodes.sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
}

export async function getNode(id: string): Promise<WorkspaceNode | null> {
  if (!isNodeId(id)) {
    return null;
  }
  const nodes = await listNodes();
  return nodes.find((node) => node.id === id) ?? null;
}

export async function searchWorkspace(query: string): Promise<SearchHit[]> {
  return searchNodes(await listNodes(), query);
}

export async function createNode(input: {
  title: string;
  kind: Kind;
  parent: string | null;
  summary?: string;
  body?: string;
}): Promise<WorkspaceNode> {
  return exclusive(async () => {
    const title = input.title.trim();
    if (!title) {
      throw new Error("A title is required.");
    }
    const nodes = await listNodes();
    assertParent(nodes, input.parent);
    const id = uniqueId(nodes, slugify(title));
    const siblings = childrenOf(nodes, input.parent);
    const node: WorkspaceNode = {
      id,
      title,
      kind: input.kind,
      parent: input.parent,
      summary: (input.summary ?? "").trim(),
      order: siblings.reduce((max, item) => Math.max(max, item.order), 0) + 1,
      updated: "",
      body: (input.body ?? "").trim(),
    };
    const saved = await writeNode(node);
    revalidatePath("/", "layout");
    return saved;
  });
}

export async function updateNode(
  id: string,
  patch: {title?: string; summary?: string; body?: string},
): Promise<WorkspaceNode> {
  return exclusive(async () => {
    const nodes = await listNodes();
    const current = nodes.find((node) => node.id === id);
    if (!current) {
      throw new Error(`No page with id "${id}".`);
    }
    const title = patch.title === undefined ? current.title : patch.title.trim();
    if (!title) {
      throw new Error("A title is required.");
    }
    const next: WorkspaceNode = {
      ...current,
      title,
      summary:
        patch.summary === undefined ? current.summary : patch.summary.trim(),
      body: patch.body === undefined ? current.body : patch.body.replace(/\s+$/, ""),
    };
    const saved = await writeNode(next);
    revalidatePath("/", "layout");
    return saved;
  });
}

export async function editNodeContent(
  id: string,
  find: string,
  replace: string,
): Promise<WorkspaceNode> {
  return exclusive(async () => {
    const nodes = await listNodes();
    const current = nodes.find((node) => node.id === id);
    if (!current) {
      throw new Error(`No page with id "${id}".`);
    }
    if (!find) {
      throw new Error("The snippet to replace is empty.");
    }
    const count = current.body.split(find).length - 1;
    if (count === 0) {
      throw new Error("That snippet is not in the page.");
    }
    if (count > 1) {
      throw new Error("That snippet appears more than once. Include more surrounding text.");
    }
    const next: WorkspaceNode = {
      ...current,
      body: current.body.replace(find, replace).replace(/\s+$/, ""),
    };
    const saved = await writeNode(next);
    revalidatePath("/", "layout");
    return saved;
  });
}

export async function moveNode(
  id: string,
  parent: string | null,
): Promise<WorkspaceNode> {
  return exclusive(async () => {
    const nodes = await listNodes();
    const current = nodes.find((node) => node.id === id);
    if (!current) {
      throw new Error(`No page with id "${id}".`);
    }
    if (current.parent === parent) {
      return current;
    }
    assertParent(nodes, parent);
    if (parent === id || descendantsOf(nodes, id).some((node) => node.id === parent)) {
      throw new Error("A page cannot be moved into itself.");
    }
    const siblings = childrenOf(nodes, parent);
    const next: WorkspaceNode = {
      ...current,
      parent,
      order: siblings.reduce((max, item) => Math.max(max, item.order), 0) + 1,
    };
    const saved = await writeNode(next);
    revalidatePath("/", "layout");
    return saved;
  });
}

export async function deleteNode(id: string): Promise<void> {
  return exclusive(async () => {
    const nodes = await listNodes();
    const current = nodes.find((node) => node.id === id);
    if (!current) {
      throw new Error(`No page with id "${id}".`);
    }
    const ids = [current.id, ...descendantsOf(nodes, current.id).map((node) => node.id)];
    await Promise.all(ids.map((itemId) => unlink(filePath(itemId))));
    revalidatePath("/", "layout");
  });
}

function assertParent(nodes: readonly WorkspaceNode[], parent: string | null) {
  if (!parent) {
    return;
  }
  const found = nodes.find((node) => node.id === parent);
  if (!found) {
    throw new Error(`No collection with id "${parent}".`);
  }
  if (found.kind !== "collection") {
    throw new Error("Pages can only be created inside a collection.");
  }
}

function uniqueId(nodes: readonly WorkspaceNode[], base: string): string {
  const taken = new Set(nodes.map((node) => node.id));
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function withTimestamp(node: WorkspaceNode): WorkspaceNode {
  return {...node, updated: new Date().toISOString()};
}

async function writeNode(node: WorkspaceNode): Promise<WorkspaceNode> {
  const next = withTimestamp(node);
  await mkdir(CONTENT_DIR, {recursive: true});
  await writeFile(filePath(next.id), serializeNode(next), "utf8");
  return next;
}

function filePath(id: string): string {
  if (!isNodeId(id)) {
    throw new Error(`Invalid workspace id "${id}".`);
  }
  return path.join(CONTENT_DIR, `${id}.md`);
}

export {searchNodes};
