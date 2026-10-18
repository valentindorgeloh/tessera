"use client";

/**
 * Sidebar Favourites (docs/drafts/p9-plan.md U2). Hidden while the tree is
 * empty. Folders are one level deep. Drag reorders a level or drops a
 * favourite onto a folder; Move up, Move down and Move to folder are the
 * keyboard path. The tree updates optimistically.
 */
import { startTransition, useOptimistic, useState } from "react";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteFavoriteFolderAction, moveFavoriteAction, moveFavoriteFolderAction, removeFavoriteAction } from "@/app/actions/favorites";
import { usePointerDrag, type DragDropEvent, type ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import {
  applyFavoriteMove,
  dropFolder,
  isFavoritesEmpty,
  moveFavoriteToLevel,
  siblingIds,
  stepFavorite,
  topEntries,
  type FavoriteMove,
  type FavoriteView,
  type FavoritesTree,
} from "@/components/favorites/tree";
import { CycleIcon, FolderIcon, FolderPlusIcon, ModuleIcon, MoveDownIcon, MoveUpIcon, PageIcon, PencilIcon, TrashIcon, ViewIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { FavoriteDialog } from "./FavoriteDialog";

const DRAG_IGNORE = 'button, input, textarea, select, [role="menuitem"], [role="menu"], [role="dialog"]';

function favoriteIcon(favorite: FavoriteView) {
  if (favorite.logo) return resolveLogoIcon(favorite.logo.icon);
  switch (favorite.entity_type) {
    case "cycle":
      return CycleIcon;
    case "module":
      return ModuleIcon;
    case "view":
      return ViewIcon;
    case "page":
      return PageIcon;
    default:
      return resolveLogoIcon(null);
  }
}

export function FavoritesSection({ tree }: { tree: FavoritesTree }) {
  const toast = useToast();
  const [shown, apply] = useOptimistic(tree, (_current: FavoritesTree, next: FavoritesTree) => next);
  const [createOpen, setCreateOpen] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  const commit = (move: FavoriteMove | null, next: FavoritesTree) => {
    if (!move) return;
    startTransition(async () => {
      apply(next);
      const result =
        move.kind === "folder"
          ? await moveFavoriteFolderAction({ folder_id: move.folder_id, before_id: move.before_id, after_id: move.after_id })
          : await moveFavoriteAction({
              favorite_id: move.favorite_id,
              folder_id: move.folder_id,
              before_id: move.before_id,
              after_id: move.after_id,
            });
      if (!result.ok) toast({ type: "error", body: result.message });
    });
  };

  const runMove = (move: FavoriteMove | null) => {
    if (!move) return;
    commit(move, applyFavoriteMove(shown, move));
  };

  const removeFavorite = (favorite: FavoriteView) => {
    startTransition(async () => {
      const result = await removeFavoriteAction({ entity_type: favorite.entity_type, entity_id: favorite.entity_id });
      if (!result.ok) toast({ type: "error", body: result.message });
    });
  };

  const deleteFolder = (folderId: string) => {
    startTransition(async () => {
      apply(dropFolder(shown, folderId));
      const result = await deleteFavoriteFolderAction({ folder_id: folderId });
      if (!result.ok) toast({ type: "error", body: result.message });
    });
  };

  const onDrop = (event: DragDropEvent) => {
    const placement = { before_id: event.before_id, after_id: event.after_id };
    const folder = shown.folders.find((entry) => entry.id === event.id);
    if (folder) {
      if (event.toContainer !== "top") return;
      runMove({ kind: "folder", folder_id: folder.id, ...placement });
      return;
    }
    const folderId = event.toContainer === "top" ? null : event.toContainer.slice("folder:".length);
    runMove({ kind: "favorite", favorite_id: event.id, folder_id: folderId, ...placement });
  };

  const entries = topEntries(shown);
  const { registerContainer, registerItem, itemHandlers } = usePointerDrag({
    onDrop,
    itemsOf: (container) => (container === "top" ? siblingIds(shown, null) : siblingIds(shown, container.slice("folder:".length))),
    ignoreSelector: DRAG_IGNORE,
  });

  if (isFavoritesEmpty(shown)) return null;

  const folderTargets = shown.folders;

  return (
    <SideNavSection
      ref={registerContainer("top")}
      title="Favorites"
      endContent={
        <IconButton label="New folder" variant="ghost" size="sm" icon={<Icon icon={FolderPlusIcon} />} tooltip="New folder" onClick={() => setCreateOpen(true)} />
      }
    >
      {entries.map((entry) => {
        if (entry.kind === "folder") {
          const { folder, items } = entry;
          return (
            <SideNavItem
              key={folder.id}
              ref={(element) => {
                registerItem(folder.id)(element);
                registerContainer(`folder:${folder.id}`)(element);
              }}
              {...itemHandlers(folder.id, "top")}
              className="tessera-favorites-row"
              label={folder.name}
              icon={FolderIcon}
              collapsible={{ defaultIsCollapsed: false }}
              actions={
                <RowMenu
                  label={`Actions for ${folder.name}`}
                  items={[
                    { id: "rename", label: "Rename", icon: <PencilIcon />, onClick: () => setRename({ id: folder.id, name: folder.name }) },
                    { id: "up", label: "Move up", icon: <MoveUpIcon />, isDisabled: stepFavorite(shown, folder.id, "up") === null, onClick: () => runMove(stepFavorite(shown, folder.id, "up")) },
                    { id: "down", label: "Move down", icon: <MoveDownIcon />, isDisabled: stepFavorite(shown, folder.id, "down") === null, onClick: () => runMove(stepFavorite(shown, folder.id, "down")) },
                    { id: "delete", label: "Delete folder", icon: <TrashIcon />, onClick: () => deleteFolder(folder.id) },
                  ]}
                />
              }
            >
              {items.length === 0 ? (
                <Stack paddingInline={4} paddingBlock={1}>
                  <Text type="supporting" color="secondary">
                    Empty
                  </Text>
                </Stack>
              ) : (
                items.map((favorite) => (
                  <FavoriteRow key={favorite.id} favorite={favorite} tree={shown} registerItem={registerItem} itemHandlers={itemHandlers} folderTargets={folderTargets} onMove={runMove} onRemove={removeFavorite} />
                ))
              )}
            </SideNavItem>
          );
        }
        return (
          <FavoriteRow
            key={entry.favorite.id}
            favorite={entry.favorite}
            tree={shown}
            container="top"
            registerItem={registerItem}
            itemHandlers={itemHandlers}
            folderTargets={folderTargets}
            onMove={runMove}
            onRemove={removeFavorite}
          />
        );
      })}
      <FavoriteDialog mode="create" isOpen={createOpen} onOpenChange={setCreateOpen} />
      <FavoriteDialog
        mode="rename"
        isOpen={rename !== null}
        onOpenChange={(open) => {
          if (!open) setRename(null);
        }}
        folderId={rename?.id}
        initialName={rename?.name}
      />
    </SideNavSection>
  );
}

function FavoriteRow({
  favorite,
  tree,
  container = `folder:${favorite.folder_id ?? ""}`,
  registerItem,
  itemHandlers,
  folderTargets,
  onMove,
  onRemove,
}: {
  favorite: FavoriteView;
  tree: FavoritesTree;
  container?: string;
  registerItem: (id: string) => (element: HTMLElement | null) => void;
  itemHandlers: (id: string, container: string) => ItemDragHandlers;
  folderTargets: { id: string; name: string }[];
  onMove: (move: FavoriteMove | null) => void;
  onRemove: (favorite: FavoriteView) => void;
}) {
  const moveItems: DropdownMenuOption[] = [
    ...folderTargets.map((folder) => ({
      id: `folder-${folder.id}`,
      label: folder.name,
      isDisabled: favorite.folder_id === folder.id,
      onClick: () => onMove(moveFavoriteToLevel(tree, favorite.id, folder.id)),
    })),
    { id: "top", label: "Top level", isDisabled: favorite.folder_id === null, onClick: () => onMove(moveFavoriteToLevel(tree, favorite.id, null)) },
  ];
  return (
    <SideNavItem
      ref={registerItem(favorite.id)}
      {...itemHandlers(favorite.id, container)}
      className="tessera-favorites-row"
      label={favorite.name}
      icon={favoriteIcon(favorite)}
      href={favorite.href}
      actions={
        <RowMenu
          label={`Actions for ${favorite.name}`}
          items={[
            { id: "open", label: "Open", href: favorite.href },
            { id: "up", label: "Move up", icon: <MoveUpIcon />, isDisabled: stepFavorite(tree, favorite.id, "up") === null, onClick: () => onMove(stepFavorite(tree, favorite.id, "up")) },
            { id: "down", label: "Move down", icon: <MoveDownIcon />, isDisabled: stepFavorite(tree, favorite.id, "down") === null, onClick: () => onMove(stepFavorite(tree, favorite.id, "down")) },
            { id: "move", label: "Move to folder", icon: <FolderIcon />, items: moveItems },
            { id: "remove", label: "Remove from favorites", icon: <TrashIcon />, onClick: () => onRemove(favorite) },
          ]}
        />
      }
    />
  );
}

function RowMenu({ label, items }: { label: string; items: DropdownMenuOption[] }) {
  return <MoreMenu label={label} size="sm" items={items} placement="below" alignment="end" />;
}
