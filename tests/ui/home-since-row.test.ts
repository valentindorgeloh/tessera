// @vitest-environment jsdom
/**
 * Since-you-were-last-here row (decision 73, fix round 5): the actor name is its
 * own run (.tessera-home-since-actor) so CSS can truncate it at phone width. The
 * full name stays in the DOM text, so the link's accessible name keeps it
 * (label-in-name) followed by the rest of the label.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SinceEntry, SinceLastVisit as SinceData } from "@/components/home/home-format";

vi.mock("@/app/actions/home", () => ({ markHomeSeenAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/ai/DigestCard", () => ({ DigestCard: () => null }));
vi.mock("@/components/ai/AiStatusProvider", () => ({ useAiStatus: () => ({ status: null }) }));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => () => undefined }));
const { SinceLastVisit } = await import("@/components/home/SinceLastVisit");

const LONG = "round5-since-very-long-agent";

function data(actorName: string): SinceData {
  const entry: SinceEntry = {
    actor: { id: "agent-1", name: actorName, kind: "agent", color: "teal" },
    target: { type: "work_item", id: "item-1", label: "WEB-1 Design review", href: "/browse/WEB-1" },
    verbs: ["updated"],
    fields: ["state_id"],
    count: 1,
    last_at: "2026-10-18T12:00:00.000Z",
    last_seq: 4,
  };
  return { anchor_seq: 1, anchor_at: "2026-10-17T12:00:00.000Z", latest_seq: 4, entries: [entry], more: 0 } as SinceData;
}

function render(actorName: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToString(createElement(SinceLastVisit, { since: data(actorName), digest: null, digestEnabled: false }));
  return host;
}

describe("SinceRow label", () => {
  it("wraps the full actor name in its own truncating run", () => {
    const actor = render(LONG).querySelector(".tessera-home-since-actor");
    expect(actor?.textContent).toBe(LONG);
  });

  it("sets no title (Astryx Text takes none), and keeps the work item key in its own run", () => {
    const host = render(LONG);
    expect(host.querySelector(".tessera-home-since-actor")?.hasAttribute("title")).toBe(false);
    expect(host.querySelector(".tessera-home-since-label")?.hasAttribute("title")).toBe(false);
    const runs = [...(host.querySelector(".tessera-home-since-label")?.children ?? [])].map((run) => run.textContent);
    expect(runs).toEqual([LONG, "WEB-1"]);
  });

  it("keeps the label text starting with the full actor, then the rest, inside the link", () => {
    const link = render(LONG).querySelector("a[href='/browse/WEB-1']");
    expect(link).not.toBeNull();
    const label = link?.querySelector(".tessera-home-since-label");
    expect(label?.textContent).toBe(`${LONG} changed the state WEB-1 Design review`);
    expect(link?.textContent?.startsWith(`${LONG} changed the state`)).toBe(true);
  });

  it("does not override the link's accessible name with an aria-label", () => {
    const link = render(LONG).querySelector("a[href='/browse/WEB-1']");
    expect(link?.hasAttribute("aria-label")).toBe(false);
    expect(link?.querySelector(".tessera-home-since-actor")?.hasAttribute("aria-label")).toBe(false);
  });
});
