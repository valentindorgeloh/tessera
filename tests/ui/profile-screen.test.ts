// @vitest-environment jsdom
/**
 * Profile header (src/components/profile/ProfileScreen.tsx, visual audit St14):
 * the bar is the two-row phone header (`tabsBelow`), the actor's avatar, name and
 * tokens share one group, and the user's own profile has no "You" token (it would
 * repeat the title). Server-rendered markup, so `renderToString` is enough.
 */
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProfileActor } from "@/lib/tessera/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/your-work/summary",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/profile/RememberLabel", () => ({ RememberLabel: () => null }));

import { ProfileScreen, type ProfileScreenProps } from "@/components/profile/ProfileScreen";

// The screen requires children, which the lint rule forbids as a prop: pass them as an argument.
const Screen = ProfileScreen as FunctionComponent<Omit<ProfileScreenProps, "children">>;

function actor(kind: ProfileActor["kind"], access: ProfileActor["access"] = "write"): ProfileActor {
  return { id: "a1", name: kind === "user" ? "You" : "mcp:visual-fixture", kind, access } as ProfileActor;
}

function render(profile: ProfileActor): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToString(createElement(Screen, { actor: profile, tab: "summary", basePath: "/your-work" }, null));
  return container;
}

describe("ProfileScreen header", () => {
  it("uses the two-row phone header with the actor in one group and the tab strip last", () => {
    const container = render(actor("agent"));
    const bar = container.querySelector(".tessera-panel-bar");
    expect(bar?.classList.contains("tessera-panel-bar--tabs-below")).toBe(true);
    expect(bar?.classList.contains("tessera-panel-bar--wraps")).toBe(false);
    const start = container.querySelector(".tessera-panel-bar-start");
    const children = [...(start?.children ?? [])];
    expect(children).toHaveLength(2);
    expect(children[0].classList.contains("tessera-profile-title")).toBe(true);
    expect(children[1].classList.contains("astryx-tab-list")).toBe(true);
    expect(children[0].querySelector(".tessera-profile-name")?.textContent).toBe("mcp:visual-fixture");
  });

  it("shows the Agent and access tokens for an agent", () => {
    const tokens = [...(render(actor("agent", "write")).querySelectorAll(".tessera-profile-title .astryx-token") ?? [])];
    expect(tokens.map((token) => token.textContent)).toEqual(["Agent", "Can write"]);
  });

  it("drops the 'You' kind token on the user's own profile", () => {
    const group = render(actor("user")).querySelector(".tessera-profile-title");
    expect(group?.querySelector(".tessera-profile-name")?.textContent).toBe("You");
    expect(group?.querySelectorAll(".astryx-token")).toHaveLength(0);
  });
});
