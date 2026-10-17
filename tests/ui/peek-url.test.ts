/**
 * Peek URL helper of the detail hosts (src/components/detail/peek-url.ts):
 * setting and dropping `?peek` while every other search param survives, the
 * same rule for `q` (filter bar, display menu), and when closing the peek may
 * go Back instead of stacking a copy of the list URL.
 */
import { describe, expect, it } from "vitest";
import { hasPeekHost, registerPeekHost } from "@/components/detail/peek-hosts";
import { closesWithBack, currentHref, mountsPeek, parsePeekPush, peekHref, peekIdOf, withSearchParam, workItemHitTarget } from "@/components/detail/peek-url";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";
const OTHER = "33333333-3333-7333-8333-333333333333";
const LIST = `/projects/${PROJECT}/work-items`;

describe("peekHref", () => {
  it("adds the peek param to a bare path", () => {
    expect(peekHref(LIST, new URLSearchParams(), ITEM)).toBe(`${LIST}?peek=${ITEM}`);
    expect(peekHref(LIST, null, ITEM)).toBe(`${LIST}?peek=${ITEM}`);
    expect(peekHref(LIST, undefined, ITEM)).toBe(`${LIST}?peek=${ITEM}`);
  });

  it("keeps the other params when opening", () => {
    const href = peekHref(LIST, new URLSearchParams("q=abc_-123&create=1"), ITEM);
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe(LIST);
    expect(url.searchParams.get("q")).toBe("abc_-123");
    expect(url.searchParams.get("create")).toBe("1");
    expect(url.searchParams.get("peek")).toBe(ITEM);
  });

  it("replaces an existing peek instead of adding a second one", () => {
    const href = peekHref(LIST, new URLSearchParams(`peek=${ITEM}&q=view`), OTHER);
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.getAll("peek")).toEqual([OTHER]);
    expect(url.searchParams.get("q")).toBe("view");
  });

  it("drops the peek and keeps q when closing", () => {
    expect(peekHref(LIST, new URLSearchParams(`q=view&peek=${ITEM}`), null)).toBe(`${LIST}?q=view`);
  });

  it("returns the bare path when closing leaves no params", () => {
    expect(peekHref(LIST, new URLSearchParams(`peek=${ITEM}`), null)).toBe(LIST);
    expect(peekHref(LIST, new URLSearchParams(), null)).toBe(LIST);
  });

  it("round-trips through peekIdOf", () => {
    const href = peekHref(LIST, new URLSearchParams("q=view"), ITEM);
    expect(peekIdOf(new URL(href, "http://localhost").searchParams)).toBe(ITEM);
  });
});

describe("mountsPeek", () => {
  it("is true for the lists of the project that mount the peek", () => {
    expect(mountsPeek(LIST, PROJECT)).toBe(true);
    expect(mountsPeek(`${LIST}/`, PROJECT)).toBe(true);
    expect(mountsPeek(`/projects/${PROJECT}/cycles/${OTHER}`, PROJECT)).toBe(true);
    expect(mountsPeek(`/projects/${PROJECT}/modules/${OTHER}/`, PROJECT)).toBe(true);
    expect(mountsPeek(`/projects/${PROJECT}/archives/work-items`, PROJECT)).toBe(true);
    expect(mountsPeek(`/projects/${PROJECT}/views/${OTHER}`, PROJECT)).toBe(true);
    expect(mountsPeek(`/projects/${PROJECT}/views/${OTHER}/`, PROJECT)).toBe(true);
  });

  it("is false for other screens of the project and for other projects", () => {
    expect(mountsPeek(`${LIST}/${ITEM}`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}/cycles`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}/modules`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}/views`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}/views/${OTHER}/extra`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}/settings/general`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}/archives`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}/archives/cycles`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${PROJECT}`, PROJECT)).toBe(false);
    expect(mountsPeek(`/projects/${OTHER}/work-items`, PROJECT)).toBe(false);
    expect(mountsPeek(`/work-items/${ITEM}`, PROJECT)).toBe(false);
    expect(mountsPeek("/projects/archives", PROJECT)).toBe(false);
  });
});

describe("workItemHitTarget (Power K)", () => {
  const CYCLE = `/projects/${PROJECT}/cycles/${OTHER}`;
  const FULL_PAGE = { href: `/projects/${PROJECT}/work-items/${ITEM}`, isPeek: false };

  it("opens a peek on a list of the item's project while its host is mounted, keeping the other params", () => {
    expect(workItemHitTarget(LIST, "?q=abc", PROJECT, ITEM, true)).toEqual({ href: `${LIST}?q=abc&peek=${ITEM}`, isPeek: true });
    expect(workItemHitTarget(CYCLE, "", PROJECT, ITEM, true)).toEqual({ href: `${CYCLE}?peek=${ITEM}`, isPeek: true });
    const VIEW = `/projects/${PROJECT}/views/${OTHER}`;
    expect(workItemHitTarget(VIEW, "", PROJECT, ITEM, true)).toEqual({ href: `${VIEW}?peek=${ITEM}`, isPeek: true });
  });

  it("opens the full page on a cycle or module route with no host (feature off, not found)", () => {
    // Cycles turned off: the cycle route keeps its URL but renders FeatureOffState, so no PeekHost is mounted.
    expect(workItemHitTarget(CYCLE, "", PROJECT, ITEM, false)).toEqual(FULL_PAGE);
    expect(workItemHitTarget(`/projects/${PROJECT}/modules/${OTHER}`, "", PROJECT, ITEM, false)).toEqual(FULL_PAGE);
    expect(workItemHitTarget(LIST, "", PROJECT, ITEM, false)).toEqual(FULL_PAGE);
  });

  it("opens the full page on screens that are no list of the item's project, even with a host mounted", () => {
    expect(workItemHitTarget(`/projects/${OTHER}/work-items`, "", PROJECT, ITEM, true)).toEqual(FULL_PAGE);
    expect(workItemHitTarget(`/projects/${PROJECT}/cycles`, "", PROJECT, ITEM, true)).toEqual(FULL_PAGE);
    expect(workItemHitTarget("/home", "", PROJECT, ITEM, true)).toEqual(FULL_PAGE);
  });
});

describe("peek host registry", () => {
  it("counts mounted hosts per project and uncounts each one once", () => {
    expect(hasPeekHost(PROJECT)).toBe(false);
    const first = registerPeekHost(PROJECT);
    const second = registerPeekHost(PROJECT);
    expect(hasPeekHost(PROJECT)).toBe(true);
    expect(hasPeekHost(OTHER)).toBe(false);
    first();
    first();
    expect(hasPeekHost(PROJECT)).toBe(true);
    second();
    expect(hasPeekHost(PROJECT)).toBe(false);
  });
});

describe("peekIdOf", () => {
  it("reads the peek param and treats an empty one as absent", () => {
    expect(peekIdOf(new URLSearchParams(`peek=${ITEM}`))).toBe(ITEM);
    expect(peekIdOf(new URLSearchParams("peek="))).toBeNull();
    expect(peekIdOf(new URLSearchParams("q=view"))).toBeNull();
    expect(peekIdOf(null)).toBeNull();
  });
});

describe("withSearchParam", () => {
  it("changes q and keeps an open peek (filters and display changed while an item is peeked)", () => {
    const href = withSearchParam(LIST, new URLSearchParams(`q=old&peek=${ITEM}`), "q", "new_-1");
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("q")).toBe("new_-1");
    expect(url.searchParams.get("peek")).toBe(ITEM);
  });

  it("drops q when it is cleared and keeps the rest", () => {
    expect(withSearchParam(LIST, new URLSearchParams(`q=old&peek=${ITEM}`), "q", null)).toBe(`${LIST}?peek=${ITEM}`);
    expect(withSearchParam(LIST, new URLSearchParams("q=old"), "q", "")).toBe(LIST);
  });

  it("adds q to a bare path", () => {
    expect(withSearchParam(LIST, null, "q", "abc")).toBe(`${LIST}?q=abc`);
  });
});

describe("currentHref", () => {
  it("joins path and query, with or without a leading ?", () => {
    expect(currentHref(LIST, new URLSearchParams(`peek=${ITEM}`))).toBe(`${LIST}?peek=${ITEM}`);
    expect(currentHref(LIST, `?peek=${ITEM}`)).toBe(`${LIST}?peek=${ITEM}`);
    expect(currentHref(LIST, "")).toBe(LIST);
    expect(currentHref(LIST, null)).toBe(LIST);
  });
});

describe("closing the peek with Back", () => {
  const opened = `${LIST}?q=view&peek=${ITEM}`;
  const list = `${LIST}?q=view`;
  const push = { from: list, to: opened, length: 4 };

  it("goes Back when the current entry is the one the list pushed and the entry before it is the list", () => {
    expect(closesWithBack(push, opened, list, 4)).toBe(true);
  });

  it("replaces otherwise: no record, another URL, filters changed meanwhile, or a different history", () => {
    expect(closesWithBack(null, opened, list, 4)).toBe(false);
    expect(closesWithBack(push, `${LIST}?q=view&peek=${OTHER}`, list, 4)).toBe(false);
    expect(closesWithBack(push, `${LIST}?q=other&peek=${ITEM}`, `${LIST}?q=other`, 4)).toBe(false);
    expect(closesWithBack(push, opened, list, 5)).toBe(false);
    expect(closesWithBack({ ...push, length: -1 }, opened, list, 4)).toBe(false);
  });

  it("parses only well-formed records", () => {
    expect(parsePeekPush(JSON.stringify(push))).toEqual(push);
    expect(parsePeekPush(null)).toBeNull();
    expect(parsePeekPush("not json")).toBeNull();
    expect(parsePeekPush(JSON.stringify({ from: list, to: opened }))).toBeNull();
    expect(parsePeekPush(JSON.stringify({ ...push, length: "4" }))).toBeNull();
  });
});
