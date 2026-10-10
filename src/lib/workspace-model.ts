export type Kind = "item" | "collection";

export type WorkspaceNode = {
  id: string;
  title: string;
  kind: Kind;
  parent: string | null;
  summary: string;
  order: number;
  updated: string;
  body: string;
};

export type SearchHit = {
  id: string;
  title: string;
  kind: Kind;
  summary: string;
  snippet: string;
};

export const WORKSPACE_NAME = "Handbook";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isNodeId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "page";
}

export function childrenOf(
  nodes: readonly WorkspaceNode[],
  parent: string | null,
): WorkspaceNode[] {
  return nodes
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function descendantsOf(
  nodes: readonly WorkspaceNode[],
  id: string,
): WorkspaceNode[] {
  return childrenOf(nodes, id).flatMap((child) => [
    child,
    ...descendantsOf(nodes, child.id),
  ]);
}

export function ancestorsOf(
  nodes: readonly WorkspaceNode[],
  id: string,
): WorkspaceNode[] {
  const node = nodes.find((item) => item.id === id);
  if (!node?.parent) {
    return [];
  }
  const parent = nodes.find((item) => item.id === node.parent);
  if (!parent) {
    return [];
  }
  return [...ancestorsOf(nodes, parent.id), parent];
}

export function recentItems(nodes: readonly WorkspaceNode[]): WorkspaceNode[] {
  return nodes
    .filter((node) => node.kind === "item")
    .sort((a, b) => {
      if (a.updated === b.updated) {
        return a.title.localeCompare(b.title);
      }
      if (!a.updated) {
        return 1;
      }
      if (!b.updated) {
        return -1;
      }
      return b.updated.localeCompare(a.updated);
    });
}

export function findNode(
  nodes: readonly WorkspaceNode[],
  id: string,
): WorkspaceNode | undefined {
  return nodes.find((node) => node.id === id);
}

export function searchNodes(
  nodes: readonly WorkspaceNode[],
  query: string,
): SearchHit[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return [];
  }

  return nodes.flatMap((node) => {
    const title = node.title.toLowerCase();
    const summary = node.summary.toLowerCase();
    const body = node.body.toLowerCase();
    const matches = terms.every(
      (term) =>
        title.includes(term) || summary.includes(term) || body.includes(term),
    );
    if (!matches) {
      return [];
    }
    return [
      {
        id: node.id,
        title: node.title,
        kind: node.kind,
        summary: node.summary,
        snippet: snippetFor(node, terms[0]),
      },
    ];
  });
}

function snippetFor(node: WorkspaceNode, term: string): string {
  const source = `${node.summary}\n${node.body}`;
  const index = source.toLowerCase().indexOf(term);
  if (index < 0) {
    return node.summary;
  }
  const start = Math.max(0, index - 40);
  const excerpt = source
    .slice(start, start + 140)
    .replace(/\s+/g, " ")
    .trim();
  return start > 0 ? `…${excerpt}` : excerpt;
}

export function parseNode(text: string): WorkspaceNode {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("A workspace file is missing frontmatter.");
  }
  const fields = parseFrontmatter(match[1]);
  const id = fields.id ?? "";
  const kind = fields.kind;
  if (!isNodeId(id)) {
    throw new Error(`Invalid workspace id "${id}".`);
  }
  if (kind !== "item" && kind !== "collection") {
    throw new Error(`Invalid kind for "${id}".`);
  }
  const parent = fields.parent?.trim() ? fields.parent.trim() : null;
  if (parent && !isNodeId(parent)) {
    throw new Error(`Invalid parent for "${id}".`);
  }
  return {
    id,
    title: fields.title ?? id,
    kind,
    parent,
    summary: fields.summary ?? "",
    order: Number(fields.order ?? "0") || 0,
    updated: fields.updated ?? "",
    body: match[2].replace(/^\n/, "").replace(/\s+$/, ""),
  };
}

export function serializeNode(node: WorkspaceNode): string {
  return [
    "---",
    `id: ${node.id}`,
    `title: ${yamlString(node.title)}`,
    `kind: ${node.kind}`,
    `parent: ${node.parent ?? ""}`,
    `summary: ${yamlString(node.summary)}`,
    `order: ${node.order}`,
    `updated: ${yamlString(node.updated)}`,
    "---",
    "",
    node.body.trimEnd(),
    "",
  ].join("\n");
}

function parseFrontmatter(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const splitAt = line.indexOf(":");
    if (splitAt === -1) {
      continue;
    }
    const key = line.slice(0, splitAt).trim();
    const raw = line.slice(splitAt + 1).trim();
    fields[key] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
  return fields;
}

function yamlString(value: string): string {
  if (value === "" || /[:#\n"'&]/.test(value) || value !== value.trim()) {
    return JSON.stringify(value);
  }
  return value;
}
