"use client";

import {useTransition} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {Button} from "@astryxdesign/core/Button";
import {Card} from "@astryxdesign/core/Card";
import {EmptyState} from "@astryxdesign/core/EmptyState";
import {HStack, Layout, LayoutContent, VStack} from "@astryxdesign/core/Layout";
import {Link} from "@astryxdesign/core/Link";
import {List, ListItem} from "@astryxdesign/core/List";
import {Tab, TabList} from "@astryxdesign/core/TabList";
import {Table, proportional} from "@astryxdesign/core/Table";
import {Heading, Text} from "@astryxdesign/core/Text";
import {
  WORKSPACE_NAME,
  childrenOf,
  descendantsOf,
  findNode,
  recentItems,
  searchNodes,
  type WorkspaceNode,
} from "../lib/workspace-model";
import {moveNodeAction} from "./actions";
import {DocumentEditor} from "./document-editor";
import {PAGE_FRAME_WIDTH, PageColumn} from "./page-column";
import {useWorkspace} from "./workspace-shell";

type View = "list" | "board" | "table" | "recent";

function readView(value: string | null): View {
  if (value === "board" || value === "table" || value === "recent") {
    return value;
  }
  return "list";
}

function formatUpdated(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${hours}:${minutes} UTC`;
}

export function WorkspaceScreen({parentId}: {parentId: string | null}) {
  const nodes = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const parent = parentId ? findNode(nodes, parentId) : undefined;
  const view = readView(params.get("view"));
  const query = params.get("q") ?? "";
  const [, startTransition] = useTransition();
  const hits = query.trim() ? searchNodes(nodes, query) : null;
  const scopeParent = parent?.kind === "collection" ? parent.id : parentId;
  const path = parentId ? `/items/${parentId}` : "/";

  const setView = (next: View) => {
    router.push(next === "list" ? path : `${path}?view=${next}`);
  };

  const clearSearch = () => {
    router.push(view === "list" ? path : `${path}?view=${view}`);
  };

  const moveItem = (itemId: string, nextParent: string) => {
    startTransition(() => {
      void moveNodeAction(itemId, nextParent).then(() => router.refresh());
    });
  };

  return (
    <Layout
      height="fill"
      contentWidth={PAGE_FRAME_WIDTH}
      content={
        <LayoutContent padding={0}>
          <PageColumn>
            <VStack gap={6}>
              {parent?.kind === "collection" ? (
                <DocumentEditor key={parent.id} node={parent} />
              ) : (
                <VStack gap={2} className="handbook-title">
                  <Heading level={1} type="display-2" weight="semibold">
                    {WORKSPACE_NAME}
                  </Heading>
                  <Text color="secondary">
                    Collections, pages, and the same notes an assistant can edit.
                  </Text>
                </VStack>
              )}
              <VStack gap={4}>
                <HStack gap={3} vAlign="center" hAlign="between">
                  <TabList
                    aria-label="View"
                    className="handbook-view-tabs"
                    size="sm"
                    value={view}
                    onChange={(next) => setView(readView(next))}
                    hasDivider
                  >
                    <Tab value="list" label="List" />
                    <Tab value="board" label="Board" />
                    <Tab value="table" label="Table" />
                    <Tab value="recent" label="Recent" />
                  </TabList>
                  {query ? (
                    <Button
                      label="Clear search"
                      variant="ghost"
                      size="sm"
                      onClick={clearSearch}
                    />
                  ) : null}
                </HStack>
                {hits ? (
                  <SearchResults hits={hits} query={query} onClear={clearSearch} />
                ) : view === "recent" ? (
                  <RecentView nodes={nodes} />
                ) : view === "board" ? (
                  <BoardView nodes={nodes} parentId={scopeParent} onMove={moveItem} />
                ) : view === "table" ? (
                  <TableView nodes={nodes} parentId={scopeParent} />
                ) : (
                  <ListView nodes={nodes} parentId={scopeParent} />
                )}
              </VStack>
            </VStack>
          </PageColumn>
        </LayoutContent>
      }
    />
  );
}

function SearchResults({
  hits,
  query,
  onClear,
}: {
  hits: ReturnType<typeof searchNodes>;
  query: string;
  onClear: () => void;
}) {
  if (hits.length === 0) {
    return (
      <EmptyState
        title="No pages match"
        description={`Nothing in the handbook mentions “${query}”.`}
        actions={
          <Button label="Clear search" variant="secondary" onClick={onClear} />
        }
      />
    );
  }

  return (
    <List hasDividers>
      {hits.map((hit) => (
        <ListItem
          key={hit.id}
          href={`/items/${hit.id}`}
          label={hit.title}
          description={hit.snippet}
          endContent={
            <Text type="supporting" color="secondary">
              {hit.kind === "collection" ? "Collection" : "Page"}
            </Text>
          }
        />
      ))}
    </List>
  );
}

function RecentView({nodes}: {nodes: WorkspaceNode[]}) {
  const items = recentItems(nodes);
  if (items.length === 0) {
    return (
      <EmptyState
        title="No pages yet"
        description="Pages you edit show up here, newest first."
      />
    );
  }

  return (
    <List hasDividers>
      {items.map((node) => (
        <ListItem
          key={node.id}
          href={`/items/${node.id}`}
          label={node.title}
          description={node.summary}
          endContent={
            <Text type="supporting" color="secondary">
              {formatUpdated(node.updated) || "Page"}
            </Text>
          }
        />
      ))}
    </List>
  );
}

function ListView({
  nodes,
  parentId,
}: {
  nodes: WorkspaceNode[];
  parentId: string | null;
}) {
  const children = childrenOf(nodes, parentId);
  if (children.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Use the sidebar to add a page or a collection."
      />
    );
  }

  return (
    <List hasDividers>
      {children.map((node) => (
        <ListItem
          key={node.id}
          href={`/items/${node.id}`}
          label={node.title}
          description={node.summary}
          endContent={
            <Text type="supporting" color="secondary">
              {node.kind === "collection" ? "Collection" : "Page"}
            </Text>
          }
        />
      ))}
    </List>
  );
}

function TableView({
  nodes,
  parentId,
}: {
  nodes: WorkspaceNode[];
  parentId: string | null;
}) {
  const source = parentId ? descendantsOf(nodes, parentId) : nodes;
  const rows = source
    .filter((node) => node.kind === "item")
    .map((node) => ({
      id: node.id,
      title: node.title,
      collection: findNode(nodes, node.parent ?? "")?.title ?? WORKSPACE_NAME,
      summary: node.summary,
    }));

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No pages in this view"
        description="Pages show up here. Collections stay in the list and the sidebar."
      />
    );
  }

  return (
    <Table
      data={rows}
      idKey="id"
      density="spacious"
      hasHover
      columns={[
        {
          key: "title",
          header: "Page",
          width: proportional(1.4),
          renderCell: (row) => <Link href={`/items/${row.id}`}>{row.title}</Link>,
        },
        {
          key: "collection",
          header: "Collection",
          width: proportional(1),
          renderCell: (row) => <Text color="secondary">{row.collection}</Text>,
        },
        {
          key: "summary",
          header: "Summary",
          width: proportional(2),
          renderCell: (row) => <Text color="secondary">{row.summary}</Text>,
        },
      ]}
    />
  );
}

function BoardView({
  nodes,
  parentId,
  onMove,
}: {
  nodes: WorkspaceNode[];
  parentId: string | null;
  onMove: (itemId: string, parentId: string) => void;
}) {
  const collections = childrenOf(nodes, parentId).filter(
    (node) => node.kind === "collection",
  );
  const looseItems = childrenOf(nodes, parentId).filter(
    (node) => node.kind === "item",
  );
  const columns = [
    ...(looseItems.length > 0 && parentId
      ? [
          {
            id: parentId,
            title: findNode(nodes, parentId)?.title ?? "Pages",
            items: looseItems,
          },
        ]
      : []),
    ...collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      items: childrenOf(nodes, collection.id).filter(
        (node) => node.kind === "item",
      ),
    })),
  ];

  if (columns.length === 0) {
    return (
      <EmptyState
        title="No collections to board"
        description="Add a collection from the sidebar, then drop pages between columns."
      />
    );
  }

  return (
    <HStack gap={3} vAlign="start" wrap="nowrap" className="handbook-board">
      {columns.map((column) => (
        <Card
          key={column.id}
          variant="muted"
          padding={3}
          width={260}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const itemId = event.dataTransfer.getData("text/plain");
            if (itemId) {
              onMove(itemId, column.id);
            }
          }}
        >
          <VStack gap={3}>
            <Heading level={3}>{column.title}</Heading>
            {column.items.length === 0 ? (
              <Text color="secondary">Drop a page here.</Text>
            ) : (
              column.items.map((item) => (
                <Card
                  key={item.id}
                  padding={3}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", item.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <VStack gap={1}>
                    <Link href={`/items/${item.id}`}>{item.title}</Link>
                    <Text type="supporting" color="secondary">
                      {item.summary}
                    </Text>
                  </VStack>
                </Card>
              ))
            )}
          </VStack>
        </Card>
      ))}
    </HStack>
  );
}
