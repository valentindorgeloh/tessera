"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {usePathname, useRouter} from "next/navigation";
import {AppShell} from "@astryxdesign/core/AppShell";
import {Button} from "@astryxdesign/core/Button";
import {FieldStatus} from "@astryxdesign/core/FieldStatus";
import {Icon} from "@astryxdesign/core/Icon";
import {IconButton} from "@astryxdesign/core/IconButton";
import {Kbd} from "@astryxdesign/core/Kbd";
import {HStack, VStack} from "@astryxdesign/core/Layout";
import {SideNav, SideNavCollapseButton, SideNavHeading} from "@astryxdesign/core/SideNav";
import {Text} from "@astryxdesign/core/Text";
import {TopNav} from "@astryxdesign/core/TopNav";
import {TreeList, type TreeListItemData} from "@astryxdesign/core/TreeList";
import {
  WORKSPACE_NAME,
  childrenOf,
  findNode,
  type Kind,
  type WorkspaceNode,
} from "../lib/workspace-model";
import {createNodeAction} from "./actions";
import {NavButtons, PageTabs, markNextNavigationAsNewTab, tabIdFromHref} from "./page-tabs";
import {SearchDialog} from "./search-dialog";
import {FolderIcon, FolderPlusIcon, PageIcon, PlusIcon, SearchIcon} from "../themes/catppuccin/icons";

const WorkspaceContext = createContext<WorkspaceNode[] | null>(null);

export function useWorkspace(): WorkspaceNode[] {
  const nodes = useContext(WorkspaceContext);
  if (!nodes) {
    throw new Error("useWorkspace must be used inside WorkspaceShell");
  }
  return nodes;
}

function createParent(pathname: string, nodes: readonly WorkspaceNode[]): string | null {
  const match = pathname.match(/^\/items\/([^/]+)/);
  if (!match) {
    return null;
  }
  const node = findNode(nodes, match[1]);
  if (!node) {
    return null;
  }
  return node.kind === "collection" ? node.id : node.parent;
}

function treeItems(
  nodes: readonly WorkspaceNode[],
  parent: string | null,
  pathname: string,
): TreeListItemData[] {
  return childrenOf(nodes, parent).map((node) => {
    const kids = childrenOf(nodes, node.id);
    const href = `/items/${node.id}`;
    return {
      id: node.id,
      label: <Text maxLines={1}>{node.title}</Text>,
      startContent: (
        <Icon
          icon={node.kind === "collection" ? FolderIcon : PageIcon}
          size="xsm"
        />
      ),
      href,
      isSelected: pathname === href,
      isExpanded: node.kind === "collection",
      children: kids.length > 0 ? treeItems(nodes, node.id, pathname) : undefined,
    };
  });
}

export function WorkspaceShell({
  nodes,
  children,
}: {
  nodes: WorkspaceNode[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [isCollapsed, setCollapsed] = useState(false);
  const [isCreating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const collapsible = {isCollapsed, onCollapsedChange: setCollapsed, hasButton: false};

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "p")
      ) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link || link.target === "_blank") return;
      const href = link.getAttribute("href");
      if (!href) return;
      const page = tabIdFromHref(href);
      if (page === null) return;
      event.preventDefault();
      markNextNavigationAsNewTab();
      router.push(href.split("#")[0]);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  const create = async (kind: Kind) => {
    setCreating(true);
    const result = await createNodeAction({
      title: kind === "collection" ? "Untitled collection" : "Untitled",
      kind,
      parent: createParent(pathname, nodes),
      summary: "",
    });
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }
    setCreateError(null);
    router.push(`/items/${result.data.id}?focus=title`);
    router.refresh();
  };

  return (
    <WorkspaceContext.Provider value={nodes}>
      <AppShell
        height="fill"
        contentPadding={0}
        variant="elevated"
        topNav={
          <TopNav
            label="Handbook"
            startContent={
              <HStack gap={1} vAlign="center">
                <SideNavCollapseButton collapsible={collapsible} size="sm" />
                <NavButtons />
              </HStack>
            }
            centerContent={<PageTabs nodes={nodes} />}
          />
        }
        sideNav={
          <SideNav
            aria-label="Handbook"
            header={<SideNavHeading heading={WORKSPACE_NAME} headingHref="/" />}
            topContent={
              <VStack gap={2}>
                <Button
                  label="Search"
                  variant="secondary"
                  size="sm"
                  width="100%"
                  icon={<Icon icon={SearchIcon} />}
                  endContent={<Kbd keys="mod+k" />}
                  onClick={() => setSearchOpen(true)}
                />
                <Button
                  label="New page"
                  variant="ghost"
                  size="sm"
                  width="100%"
                  icon={<Icon icon={PlusIcon} />}
                  isDisabled={isCreating}
                  onClick={() => {
                    void create("item");
                  }}
                />
              </VStack>
            }
            collapsible={collapsible}
            resizable={{defaultWidth: 240, minWidth: 180, maxWidth: 400}}
          >
            <TreeList
              items={treeItems(nodes, null, pathname)}
              density="compact"
              header={
                <VStack gap={2}>
                  <HStack gap={1} vAlign="center" hAlign="between">
                    <Text type="supporting" color="secondary">
                      Pages
                    </Text>
                    <IconButton
                      label="New collection"
                      tooltip="New collection"
                      variant="ghost"
                      isDisabled={isCreating}
                      icon={<Icon icon={FolderPlusIcon} size="sm" />}
                      onClick={() => {
                        void create("collection");
                      }}
                    />
                  </HStack>
                  {createError ? (
                    <FieldStatus
                      variant="detached"
                      type="error"
                      message={createError}
                    />
                  ) : null}
                </VStack>
              }
            />
          </SideNav>
        }
      >
        {children}
      </AppShell>
      <SearchDialog isOpen={searchOpen} onOpenChange={setSearchOpen} nodes={nodes} />
    </WorkspaceContext.Provider>
  );
}
