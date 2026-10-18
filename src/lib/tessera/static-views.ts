/**
 * Virtual workspace views. They are not saved views: the list scope is the
 * whole workspace, or the user actor's assigned, created or subscribed items.
 */
import { USER_ACTOR_ID } from "./actors";
import { StaticViewKeySchema } from "./schemas";
import type { StaticViewKey } from "./types";
import type { ListScope } from "./work-items";

export { STATIC_WORKSPACE_VIEWS, StaticViewKeySchema } from "./schemas";
export type { StaticViewKey } from "./types";

const STATIC_SCOPE_IDS = {
  all: "workspace",
  assigned: "static:assigned",
  created: "static:created",
  subscribed: "static:subscribed",
} as const;

/** view_settings scope_id for a static view. `all` uses the workspace row. */
export function staticViewSettingsId(key: StaticViewKey): string {
  return key === "all" ? STATIC_SCOPE_IDS.all : STATIC_SCOPE_IDS[key];
}

/** List scope a static workspace view opens. */
export function staticViewScope(key: StaticViewKey): ListScope {
  const parsed = StaticViewKeySchema.parse(key);
  if (parsed === "all") return { type: "workspace" };
  return { type: "profile", actor_id: USER_ACTOR_ID, tab: parsed };
}
