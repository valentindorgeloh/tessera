import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { createProject } from "@/lib/tessera/projects";
import { staticViewScope, staticViewSettingsId } from "@/lib/tessera/static-views";
import { getViewSettings, saveViewSettings } from "@/lib/tessera/view-settings";
import { createTestDb } from "./helpers/db";

describe("static views", () => {
  it("maps static keys onto workspace and profile scopes and remembers display", () => {
    expect(staticViewScope("all")).toEqual({ type: "workspace" });
    expect(staticViewScope("assigned")).toEqual({ type: "profile", actor_id: USER_ACTOR_ID, tab: "assigned" });
    expect(staticViewSettingsId("subscribed")).toBe("static:subscribed");
    const handles = createTestDb();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    createProject(ctx, { name: "Web", identifier: "WEB" });
    saveViewSettings(ctx, "workspace", "static:assigned", { display: { layout: "table" } });
    expect(getViewSettings(ctx, "workspace", "static:assigned").display.layout).toBe("table");
  });
});
