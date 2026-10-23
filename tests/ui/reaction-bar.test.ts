// @vitest-environment jsdom
/**
 * The reaction bar (decision 57): the eight emoji match the engine's set, chips
 * are toggle buttons named "<emoji name> reaction, N" with aria-pressed for the
 * user's own, a click toggles at once and calls the add or remove action, a
 * failure puts the chip back and toasts (decision 13), the add button opens the
 * eight emoji, and an archived item shows the chips without a way to change
 * them. The comment item renders the same bar under its body. The Server Action
 * wrappers and the toast are mocked; jsdom has no layout.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { REACTION_EMOJI } from "@/lib/tessera/reactions";

const ok = { ok: true as const, data: [], cursor: 1 };
const toast = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/relations-comments", () => ({
  addRelationAction: vi.fn(),
  removeRelationAction: vi.fn(),
  addReactionAction: actions.add,
  removeReactionAction: actions.remove,
  createCommentAction: vi.fn(),
  updateCommentAction: vi.fn(),
  deleteCommentAction: vi.fn(),
}));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()), useToast: () => toast }));

const { ReactionBar } = await import("@/components/detail/ReactionBar");
const { CommentItem } = await import("@/components/detail/CommentItem");
const { REACTION_CHOICES, hasReacted, isReactionEmoji, reactionChipLabel, reactionName, toggleReaction } = await import("@/components/detail/reaction-model");
type ReactionSummary = import("@/components/detail/reaction-model").ReactionSummary;

const ITEM = "22222222-2222-7222-8222-222222222222";
const ME = "55555555-5555-7555-8555-555555555555";
const ADA = "66666666-6666-7666-8666-666666666666";

const reactions: ReactionSummary[] = [
  { reaction: "👍", count: 2, actor_ids: [ADA, ME] },
  { reaction: "🚀", count: 1, actor_ids: [ADA] },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(node: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

function bar(props: { reactions?: ReactionSummary[]; readOnly?: boolean } = {}) {
  return createElement(ReactionBar, { target: "work_item", targetId: ITEM, reactions: props.reactions ?? reactions, currentActorId: ME, readOnly: props.readOnly });
}

function chip(name: string): HTMLButtonElement | null {
  return document.querySelector(`button[aria-label="${name}"]`);
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  actions.add.mockReset();
  actions.remove.mockReset();
  toast.mockReset();
});

describe("reaction model", () => {
  it("keeps the client's emoji list equal to the engine's, in order", () => {
    expect(REACTION_CHOICES.map((choice) => choice.emoji)).toEqual([...REACTION_EMOJI]);
    expect(new Set(REACTION_CHOICES.map((choice) => choice.name)).size).toBe(REACTION_EMOJI.length);
  });

  it("names a chip after the emoji and its count", () => {
    expect(reactionName("👍")).toBe("thumbs up");
    expect(reactionChipLabel("👍", 2)).toBe("thumbs up reaction, 2");
    expect(isReactionEmoji("🚀")).toBe(true);
    expect(isReactionEmoji("🦄")).toBe(false);
  });

  it("toggles a reaction on and off, drops a chip that reaches zero and keeps the emoji order", () => {
    const added = toggleReaction(reactions, "🎉", ME);
    expect(added.map((entry) => entry.reaction)).toEqual(["👍", "🎉", "🚀"]);
    expect(added[1]).toEqual({ reaction: "🎉", count: 1, actor_ids: [ME] });
    const joined = toggleReaction(reactions, "🚀", ME);
    expect(joined.find((entry) => entry.reaction === "🚀")).toEqual({ reaction: "🚀", count: 2, actor_ids: [ADA, ME] });
    const taken = toggleReaction(reactions, "👍", ME);
    expect(taken.find((entry) => entry.reaction === "👍")).toEqual({ reaction: "👍", count: 1, actor_ids: [ADA] });
    expect(toggleReaction(toggleReaction([], "❤️", ME), "❤️", ME)).toEqual([]);
    expect(hasReacted(reactions, "👍", ME)).toBe(true);
    expect(hasReacted(reactions, "🚀", ME)).toBe(false);
  });
});

describe("ReactionBar", () => {
  it("shows a toggle chip per reaction with its count, pressed for the user's own", async () => {
    await mount(bar());
    const thumbs = chip("thumbs up reaction, 2");
    const rocket = chip("rocket reaction, 1");
    expect(thumbs?.getAttribute("aria-pressed")).toBe("true");
    expect(rocket?.getAttribute("aria-pressed")).toBe("false");
    expect(thumbs?.textContent).toContain("👍");
    expect(thumbs?.textContent).toContain("2");
    expect(document.querySelector('[role="group"][aria-label="Reactions"]')).not.toBeNull();
    expect(chip("Add reaction")).not.toBeNull();
  });

  it("takes the user's reaction back at once and calls the remove action", async () => {
    actions.remove.mockResolvedValue(ok);
    await mount(bar());
    await click(chip("thumbs up reaction, 2"));
    expect(actions.remove).toHaveBeenCalledWith({ target: "work_item", target_id: ITEM, reaction: "👍" });
    expect(actions.add).not.toHaveBeenCalled();
  });

  it("adds a reaction the user lacks and shows it before the action answers", async () => {
    let finish: (value: typeof ok) => void = () => {};
    actions.add.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await mount(bar());
    await click(chip("rocket reaction, 1"));
    expect(actions.add).toHaveBeenCalledWith({ target: "work_item", target_id: ITEM, reaction: "🚀" });
    expect(chip("rocket reaction, 2")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => finish(ok));
  });

  it("reverts the chip and toasts when the action fails (decision 13)", async () => {
    let finish: (value: { ok: false; code: string; message: string }) => void = () => {};
    actions.add.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await mount(bar());
    await click(chip("rocket reaction, 1"));
    expect(chip("rocket reaction, 2")).not.toBeNull();
    await act(async () => finish({ ok: false, code: "ARCHIVED", message: "Archived work items are read-only" }));
    expect(chip("rocket reaction, 1")?.getAttribute("aria-pressed")).toBe("false");
    expect(chip("rocket reaction, 2")).toBeNull();
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "Could not add the reaction: Archived work items are read-only" });
  });

  it("opens the eight emoji from the add button and reacts with the one picked", async () => {
    actions.add.mockResolvedValue(ok);
    await mount(bar({ reactions: [] }));
    expect(document.querySelectorAll(".tessera-reaction")).toHaveLength(0);
    await click(chip("Add reaction"));
    const choices = [...document.querySelectorAll('[role="group"][aria-label="Choose a reaction"] button')];
    expect(choices.map((entry) => entry.getAttribute("aria-label"))).toEqual(REACTION_CHOICES.map((choice) => `React with ${choice.name}`));
    await click(choices[3] ?? null);
    expect(actions.add).toHaveBeenCalledWith({ target: "work_item", target_id: ITEM, reaction: "🎉" });
  });

  it("is read-only on an archived item: chips stay but cannot change, no add button, and an empty bar vanishes", async () => {
    await mount(bar({ readOnly: true }));
    expect(chip("thumbs up reaction, 2")?.disabled).toBe(true);
    expect(chip("Add reaction")).toBeNull();
    await act(async () => {
      root?.render(bar({ reactions: [], readOnly: true }));
    });
    expect(container?.textContent).toBe("");
  });
});

describe("CommentItem reactions", () => {
  const comment = {
    id: "77777777-7777-7777-8777-777777777777",
    work_item_id: ITEM,
    parent_comment_id: null,
    actor_id: ADA,
    actor_name: "Ada",
    actor_kind: "user",
    body_md: "Looks good",
    body_version: 1,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    reactions: [{ reaction: "👀", count: 1, actor_ids: [ME] }],
    replies: [],
  } as unknown as import("@/components/detail/CommentItem").CommentView;

  it("renders the comment's reactions under its body and reacts on the comment", async () => {
    actions.remove.mockResolvedValue(ok);
    await mount(
      createElement(CommentItem, { comment, rootId: comment.id, workItemId: ITEM, projectId: null, readOnly: false, currentActorId: ME, mentionActors: [] }),
    );
    const eyes = chip("eyes reaction, 1");
    expect(eyes?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[role="group"][aria-label="Reactions to the comment by Ada"]')).not.toBeNull();
    await click(eyes);
    expect(actions.remove).toHaveBeenCalledWith({ target: "comment", target_id: comment.id, reaction: "👀" });
  });
});
