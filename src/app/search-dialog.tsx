"use client";

import {useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Card} from "@astryxdesign/core/Card";
import {Dialog} from "@astryxdesign/core/Dialog";
import {Divider} from "@astryxdesign/core/Divider";
import {DropdownMenu, type DropdownMenuOption} from "@astryxdesign/core/DropdownMenu";
import {EmptyState} from "@astryxdesign/core/EmptyState";
import {Icon} from "@astryxdesign/core/Icon";
import {IconButton} from "@astryxdesign/core/IconButton";
import {Kbd} from "@astryxdesign/core/Kbd";
import {HStack, VStack} from "@astryxdesign/core/Layout";
import {Link} from "@astryxdesign/core/Link";
import {List, ListItem} from "@astryxdesign/core/List";
import {Markdown} from "@astryxdesign/core/Markdown";
import {Heading, Text} from "@astryxdesign/core/Text";
import {TextInput} from "@astryxdesign/core/TextInput";
import {ToggleButton} from "@astryxdesign/core/ToggleButton";
import {ArrowSquareOut} from "@phosphor-icons/react";
import {
  WORKSPACE_NAME,
  descendantsOf,
  findNode,
  recentItems,
  searchNodes,
  type WorkspaceNode,
} from "../lib/workspace-model";
import {FolderIcon, PageIcon, SearchIcon} from "../themes/catppuccin/icons";
import {markNextNavigationAsNewTab, tabHref} from "./page-tabs";

type SearchRow = {
  id: string;
  title: string;
  kind: WorkspaceNode["kind"];
  snippet: string;
  updated: string;
};

function isToday(updated: string) {
  if (!updated) return false;
  const date = new Date(updated);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

function parentTitle(nodes: WorkspaceNode[], node: WorkspaceNode) {
  if (!node.parent) return WORKSPACE_NAME;
  return findNode(nodes, node.parent)?.title ?? WORKSPACE_NAME;
}

function scopedNodes(nodes: WorkspaceNode[], collectionId: string | null) {
  if (!collectionId) return nodes;
  const root = findNode(nodes, collectionId);
  if (!root) return nodes;
  return [root, ...descendantsOf(nodes, collectionId)];
}

function collectResults(
  nodes: WorkspaceNode[],
  query: string,
  titleOnly: boolean,
  collectionId: string | null,
): SearchRow[] {
  const pool = scopedNodes(nodes, collectionId);
  const needle = query.trim();
  if (!needle) {
    return recentItems(pool).map((node) => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      snippet: node.summary,
      updated: node.updated,
    }));
  }
  if (titleOnly) {
    const terms = needle.toLowerCase().split(/\s+/).filter(Boolean);
    return pool.flatMap((node) => {
      const title = node.title.toLowerCase();
      if (!terms.every((term) => title.includes(term))) return [];
      return [
        {
          id: node.id,
          title: node.title,
          kind: node.kind,
          snippet: node.summary,
          updated: node.updated,
        },
      ];
    });
  }
  return searchNodes(pool, needle).map((hit) => {
    const node = findNode(nodes, hit.id);
    return {
      id: hit.id,
      title: hit.title,
      kind: hit.kind,
      snippet: hit.snippet,
      updated: node?.updated ?? "",
    };
  });
}

function groupRows(rows: SearchRow[], emptyQuery: boolean) {
  if (emptyQuery) return [{label: "Recent", rows}];
  const today = rows.filter((row) => isToday(row.updated));
  const older = rows.filter((row) => !isToday(row.updated));
  const groups: Array<{label: string; rows: SearchRow[]}> = [];
  if (today.length > 0) groups.push({label: "Today", rows: today});
  if (older.length > 0) groups.push({label: "Older", rows: older});
  return groups;
}

export function SearchDialog({
  isOpen,
  onOpenChange,
  nodes,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: WorkspaceNode[];
}) {
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      aria-label="Search the handbook"
      width={920}
      maxHeight="72vh"
      padding={0}
      purpose="info"
    >
      {isOpen ? (
        <SearchDialogBody nodes={nodes} onOpenChange={onOpenChange} />
      ) : null}
    </Dialog>
  );
}

function SearchDialogBody({
  nodes,
  onOpenChange,
}: {
  nodes: WorkspaceNode[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [titleOnly, setTitleOnly] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const rows = useMemo(
    () => collectResults(nodes, query, titleOnly, collectionId),
    [nodes, query, titleOnly, collectionId],
  );
  const groups = useMemo(() => groupRows(rows, query.trim() === ""), [rows, query]);

  const highlighted = rows.find((row) => row.id === highlightId) ?? rows[0] ?? null;
  const highlightedNode = highlighted ? findNode(nodes, highlighted.id) : undefined;

  const openRow = (id: string, asNewTab: boolean) => {
    if (asNewTab) markNextNavigationAsNewTab();
    router.push(tabHref(id));
    onOpenChange(false);
  };

  const collections = nodes.filter((node) => node.kind === "collection");
  const inItems: DropdownMenuOption[] = [
    {id: "all", label: "Everywhere", onClick: () => setCollectionId(null)},
    ...collections.map((collection) => ({
      id: collection.id,
      label: collection.title,
      onClick: () => setCollectionId(collection.id),
    })),
  ];
  const inLabel = collectionId
    ? (findNode(nodes, collectionId)?.title ?? "In")
    : "In";

  const moveHighlight = (delta: number) => {
    if (rows.length === 0) return;
    const index = highlighted ? rows.findIndex((row) => row.id === highlighted.id) : 0;
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (next) setHighlightId(next.id);
  };

  return (
      <VStack>
        <VStack padding={3} gap={2}>
          <TextInput
            label="Search in Handbook"
            isLabelHidden
            size="md"
            value={query}
            onChange={setQuery}
            placeholder="Search in Handbook..."
            startIcon={<Icon icon={SearchIcon} />}
            hasAutoFocus
            hasClear
            autoComplete="off"
            width="100%"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveHighlight(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveHighlight(-1);
              } else if (event.key === "Enter" && highlighted) {
                event.preventDefault();
                openRow(highlighted.id, event.metaKey || event.ctrlKey);
              }
            }}
          />
          <HStack gap={2} vAlign="center">
            <ToggleButton
              label="Title only"
              size="sm"
              isPressed={titleOnly}
              onPressedChange={setTitleOnly}
            />
            <DropdownMenu
              button={{label: inLabel, variant: "ghost", size: "sm"}}
              items={inItems}
              menuWidth={220}
            />
          </HStack>
        </VStack>
        <Divider />
        <HStack className="handbook-search-body" vAlign="stretch">
          <VStack className="handbook-search-results" isScrollable padding={2} gap={3}>
            {rows.length === 0 ? (
              <EmptyState isCompact title="No pages match" description="Try a different word or clear the filters." />
            ) : (
              groups.map((group) => (
                <VStack key={group.label} gap={1}>
                  <Text type="supporting" color="secondary">
                    {group.label}
                  </Text>
                  <List>
                    {group.rows.map((row) => {
                      const node = findNode(nodes, row.id);
                      return (
                        <ListItem
                          key={row.id}
                          href={tabHref(row.id)}
                          label={`${row.title} — ${node ? parentTitle(nodes, node) : WORKSPACE_NAME}`}
                          description={query.trim() ? row.snippet : undefined}
                          isSelected={highlighted?.id === row.id}
                          startContent={
                            <Icon icon={row.kind === "collection" ? FolderIcon : PageIcon} size="sm" />
                          }
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey) {
                              event.preventDefault();
                              openRow(row.id, true);
                              return;
                            }
                            onOpenChange(false);
                          }}
                          onMouseEnter={() => setHighlightId(row.id)}
                        />
                      );
                    })}
                  </List>
                </VStack>
              ))
            )}
          </VStack>
          <Divider orientation="vertical" />
          <VStack className="handbook-search-preview" padding={3} gap={2}>
            {highlightedNode ? (
              <Card variant="muted" padding={4} height="100%">
                <VStack gap={3} isScrollable>
                  <HStack hAlign="between" vAlign="start">
                    <Text type="supporting" color="secondary">
                      {parentTitle(nodes, highlightedNode)}
                    </Text>
                    <IconButton
                      label="Open"
                      tooltip="Open"
                      variant="ghost"
                      size="sm"
                      icon={<ArrowSquareOut weight="duotone" size={16} aria-hidden />}
                      onClick={() => openRow(highlightedNode.id, false)}
                    />
                  </HStack>
                  <Heading level={3}>{highlightedNode.title}</Heading>
                  <Markdown
                    density="compact"
                    headingLevelStart={4}
                    components={{
                      link: ({href, children}) => {
                        const next = href.startsWith("item:") ? `/items/${href.slice(5)}` : href;
                        return <Link href={next}>{children}</Link>;
                      },
                    }}
                  >
                    {highlightedNode.body}
                  </Markdown>
                </VStack>
              </Card>
            ) : (
              <EmptyState isCompact title="Pick a page" description="The preview follows the highlighted result." />
            )}
          </VStack>
        </HStack>
        <Divider />
        <HStack padding={3} gap={4} vAlign="center">
          <HStack gap={1} vAlign="center">
            <Kbd keys="enter" />
            <Text type="supporting" color="secondary">
              Open
            </Text>
          </HStack>
          <HStack gap={1} vAlign="center">
            <Kbd keys="mod+enter" />
            <Text type="supporting" color="secondary">
              Open in new tab
            </Text>
          </HStack>
          <HStack gap={1} vAlign="center">
            <Kbd keys="escape" />
            <Text type="supporting" color="secondary">
              Close
            </Text>
          </HStack>
        </HStack>
      </VStack>
  );
}
