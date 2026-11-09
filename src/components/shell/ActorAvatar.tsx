"use client";

import { useMemo, type ComponentProps } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import type { ActorKind, PaletteColor } from "@/lib/tessera/types";
import { agentGlyphSrc } from "@/themes/catppuccin/agent-glyph";

/** What an avatar needs to know about an actor; every actor row and view carries these four. */
export type AvatarActor = { id: string; name: string; kind: ActorKind; color: PaletteColor };

type ActorAvatarProps = Omit<ComponentProps<typeof Avatar>, "src" | "fallbackSrc" | "shape" | "name"> & {
  /** The actor, or null when only a name is known (a removed actor, an old record). */
  actor: AvatarActor | null;
  /** Shown when `actor` is null; defaults to the actor's own name. */
  name?: string;
};

/**
 * Avatar for any actor (docs/contracts/ui.md "Actors"). People keep the round
 * initials avatar. Agents, the Assistant and System get a generated glyph on a
 * rounded tile in their palette colour (`agent-glyph.ts`), so a bot never reads
 * as a person and two bots tell apart at a glance. Inside an AvatarGroup the
 * group's shape wins, and the glyph is drawn to survive the round crop.
 */
export function ActorAvatar({ actor, name, ...rest }: ActorAvatarProps) {
  const isBot = actor !== null && actor.kind !== "user";
  const id = actor?.id;
  const kind = actor?.kind;
  const color = actor?.color;
  const src = useMemo(() => (isBot && id && kind && color ? agentGlyphSrc({ id, kind, color }) : undefined), [isBot, id, kind, color]);
  const label = actor?.name ?? name;
  return src ? <Avatar {...rest} name={label} src={src} shape="rounded" /> : <Avatar {...rest} name={label} />;
}
