"use client";

/**
 * Star for one entity (docs/drafts/p9-plan.md U2). A favourite shows a filled
 * star in the warning colour (yellow) on a plain ghost button; it is not a
 * ToggleButton, whose pressed background read as a held-down button. The
 * label names the action ("Add to favorites" / "Remove from favorites"), so
 * there is no aria-pressed. The layout's tree wins once it has loaded;
 * `isFavorite` covers a page that already knows.
 */
import { useState, useTransition } from "react";
import type { ButtonSize } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { useToast } from "@astryxdesign/core/Toast";
import { addFavoriteAction, removeFavoriteAction } from "@/app/actions/favorites";
import { useIsFavorite } from "@/components/favorites/store";
import type { FavoriteEntityType } from "@/lib/tessera/types";
import { StarFillIcon, StarIcon } from "@/themes/catppuccin/icons";

export type FavoriteButtonProps = {
  entityType: FavoriteEntityType;
  entityId: string;
  isFavorite?: boolean;
  size?: ButtonSize;
};

export function useFavoriteToggle(entityType: FavoriteEntityType, entityId: string, isFavorite = false): {
  isFavorite: boolean;
  label: string;
  toggle: () => void;
} {
  const stored = useIsFavorite(entityType, entityId);
  const resolved = isFavorite || stored;
  const [override, setOverride] = useState<{ value: boolean; base: boolean } | null>(null);
  const toast = useToast();
  const [, startTransition] = useTransition();
  const pressed = override !== null && override.base === resolved ? override.value : resolved;

  const toggle = () => {
    const next = !pressed;
    setOverride({ value: next, base: resolved });
    startTransition(async () => {
      const result = next
        ? await addFavoriteAction({ entity_type: entityType, entity_id: entityId })
        : await removeFavoriteAction({ entity_type: entityType, entity_id: entityId });
      if (!result.ok) {
        setOverride(null);
        toast({ type: "error", body: result.message });
      }
    });
  };

  return { isFavorite: pressed, label: pressed ? "Remove from favorites" : "Add to favorites", toggle };
}

export function FavoriteButton({ entityType, entityId, isFavorite = false, size = "sm" }: FavoriteButtonProps) {
  const favorite = useFavoriteToggle(entityType, entityId, isFavorite);
  return (
    <IconButton
      label={favorite.label}
      variant="ghost"
      size={size}
      tooltip={favorite.label}
      icon={favorite.isFavorite ? <Icon icon={StarFillIcon} color="warning" /> : <Icon icon={StarIcon} />}
      onClick={favorite.toggle}
    />
  );
}
