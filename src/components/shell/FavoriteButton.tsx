"use client";

/**
 * Star for one entity (docs/drafts/p9-plan.md U2). Pressed means it is a
 * favourite. The layout's tree wins once it has loaded; `isFavorite` covers
 * a page that already knows. StarIcon is not exported, so the glyph is the
 * logo Star from the icon set.
 */
import { useState, useTransition } from "react";
import type { ButtonSize } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { useToast } from "@astryxdesign/core/Toast";
import { addFavoriteAction, removeFavoriteAction } from "@/app/actions/favorites";
import { useIsFavorite } from "@/components/favorites/store";
import type { FavoriteEntityType } from "@/lib/tessera/types";
import { resolveLogoIcon } from "@/themes/catppuccin/icons";

const StarGlyph = resolveLogoIcon("Star");

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
    <ToggleButton
      label={favorite.label}
      size={size}
      isIconOnly
      isPressed={favorite.isFavorite}
      icon={<Icon icon={StarGlyph} />}
      pressedIcon={<Icon icon={StarGlyph} />}
      onPressedChange={() => favorite.toggle()}
    />
  );
}
