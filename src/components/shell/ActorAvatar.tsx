"use client";

import { useMemo, type ComponentProps } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import type { ActorKind, PaletteColor } from "@/lib/tessera/types";
import { agentGlyphSrc } from "@/themes/catppuccin/agent-glyph";
import { humanGlyphSrc } from "@/themes/catppuccin/human-glyph";

/** What an avatar needs to know about an actor; every actor row and view carries these four. */
export type AvatarActor = { id: string; name: string; kind: ActorKind; color: PaletteColor };

type ActorAvatarProps = Omit<ComponentProps<typeof Avatar>, "src" | "fallbackSrc" | "shape" | "name"> & {
  /** The actor, or null when only a name is known (a removed actor, an old record). */
  actor: AvatarActor | null;
  /** Shown when `actor` is null; defaults to the actor's own name. */
  name?: string;
};

/**
 * Avatar for any actor (docs/contracts/ui.md "Actors"). Every known actor gets
 * a generated glyph in its palette colour. People (`kind: "user"`) get a warm
 * head-and-shoulders bust on the round avatar (`human-glyph.ts`), so the human
 * in the loop stands out among the bots. Agents, the Assistant and System get a
 * robot face, sparkle or gear on a rounded tile (`agent-glyph.ts`), so a bot
 * never reads as a person and two bots tell apart at a glance. Only a null
 * actor (a removed one, an old record) keeps Astryx's initials. Inside an
 * AvatarGroup the group's shape wins, and both glyphs survive the round crop.
 * The accessible name stays the actor's name ("You" for the local user).
 */
export function ActorAvatar({ actor, name, ...rest }: ActorAvatarProps) {
  const id = actor?.id;
  const kind = actor?.kind;
  const color = actor?.color;
  const src = useMemo(() => {
    if (!id || !kind || !color) return undefined;
    return kind === "user" ? humanGlyphSrc({ id, color }) : agentGlyphSrc({ id, kind, color });
  }, [id, kind, color]);
  const label = actor?.name ?? name;
  if (!src) return <Avatar {...rest} name={label} />;
  return <Avatar {...rest} name={label} src={src} shape={kind === "user" ? "circle" : "rounded"} />;
}
