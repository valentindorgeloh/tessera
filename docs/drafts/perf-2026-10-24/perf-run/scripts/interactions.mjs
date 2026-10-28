// d. Interactions on LARGE at 1440: peek open from the list, state change from the peek, board "Move to", list quick
// add, Power K open + search. Time = input event (capture phase timeStamp) to the visible result, polled per frame.
// Also records the server round trip (RSC navigation or Server Action POST) behind each one.
// Usage: node interactions.mjs [none|cpu4] [runs=5]
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { SETS, median, pct, load } from "./routes.mjs";
import { NAV_INIT } from "./nav-init.mjs";

const throttle = process.argv[2] ?? "none";
const runs = Number(process.argv[3] ?? 5);
const SET = process.env.SET ?? "large";
const { port, project } = SETS[SET];
const base = `http://127.0.0.1:${port}`;
const P = `/projects/${project}`;
const DB = new URL(SET === "large" ? "../prod/data/p11-perf.db" : "../prod/data/small.db", import.meta.url).pathname;
const OUT = new URL(`../results/${SET === "large" ? "" : "smoke-"}interactions-${SET}-${throttle}${process.env.ONLY ? "-" + process.env.ONLY : ""}.json`, import.meta.url).pathname;
const MAX = throttle === "cpu4" ? 120_000 : 60_000;
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");

const IDENT = execSync(`sqlite3 ${DB} "select identifier from project where id='${project}'"`).toString().trim();
const rows = execSync(`sqlite3 -separator '|' ${DB} "select sequence_id, name from work_item where project_id='${project}' and archived_at is null and deleted_at is null order by sort_order limit 8"`)
  .toString()
  .trim()
  .split("\n")
  .map((l) => {
    const [seq, ...name] = l.split("|");
    return { key: `${IDENT}-${seq}`, name: name.join("|") };
  });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
if (throttle === "cpu4") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const reqs = [];
const byId = new Map();
cdp.on("Network.requestWillBeSent", (e) => {
  const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const kind = "next-action" in h ? "action" : "next-router-prefetch" in h ? "prefetch" : "rsc" in h ? "rsc" : e.request.url.includes("/api/") ? "api" : null;
  if (!kind) return;
  const r = { kind, url: e.request.url.replace(base, "").slice(0, 120), sentAt: Date.now(), ts: e.timestamp, ms: null, kb: null };
  reqs.push(r);
  byId.set(e.requestId, r);
});
cdp.on("Network.loadingFinished", (e) => {
  const r = byId.get(e.requestId);
  if (r) {
    r.ms = Math.round((e.timestamp - r.ts) * 1000);
    r.kb = Math.round(e.encodedDataLength / 1024);
  }
});
await page.addInitScript(NAV_INIT);
await page.addInitScript(() => {
  // A spec with `fn` (a function body returning a boolean) replaces the selector check.
  const orig = window.__arm;
  window.__armFn = (fnBody) => {
    const fn = new Function(fnBody);
    window.__nav = { t0: null, ready: null, dt: null };
    const onInput = (ev) => {
      if (window.__nav.t0 === null) window.__nav.t0 = ev.timeStamp;
    };
    document.addEventListener("pointerdown", onInput, { capture: true, once: true });
    document.addEventListener("keydown", onInput, { capture: true, once: true });
    const tick = () => {
      if (window.__nav.t0 !== null && fn()) {
        window.__nav.ready = performance.now();
        window.__nav.dt = window.__nav.ready - window.__nav.t0;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  void orig;
});

const settle = () => page.evaluate((max) => window.__settle(1000, max), MAX);
const waitNav = async () => {
  const ok = await page.waitForFunction(() => window.__nav.dt !== null, null, { timeout: MAX, polling: 50 }).then(() => true, () => false);
  const nav = await page.evaluate(() => window.__nav);
  return ok ? Math.round(nav.dt) : null;
};
const since = (t) => reqs.filter((r) => r.sentAt >= t - 5).map(({ kind, url, ms, kb }) => ({ kind, url, ms, kb }));

async function openList(url) {
  await page.goto(base + url, { waitUntil: "load", timeout: MAX });
  await page.locator("[data-list-ready]").first().waitFor({ state: "visible", timeout: MAX });
  return settle();
}

const result = { throttle, runs, startedAt: new Date().toISOString(), loadBefore: load(), items: rows, peekOpen: [], stateChange: [], boardMove: [], quickAdd: [], powerKOpen: [], powerKSearch: [], setup: {} };
const peek = page.getByRole("complementary", { name: "Work item" });

// 1. Peek open from the list, then Escape.
const ONLY = process.env.ONLY;
if (!ONLY) result.setup.listSettleMs = await openList(`${P}/work-items`);
for (let i = 0; i < (ONLY ? 0 : runs); i++) {
  const item = rows[i];
  const btn = page.getByRole("button", { name: item.key, exact: true }).filter({ visible: true }).first();
  await btn.waitFor({ state: "visible", timeout: MAX });
  await page.evaluate((name) => window.__armFn(`return [...document.querySelectorAll('[role="complementary"] h2, [role="complementary"] h1')].some((h) => h.checkVisibility() && h.textContent.includes(${JSON.stringify(name)}))`), item.name);
  const t = Date.now();
  await btn.click({ timeout: MAX });
  const dt = await waitNav();
  const busy = await settle();
  result.peekOpen.push({ key: item.key, dt, busyAfter: busy, reqs: since(t) });
  await page.keyboard.press("Escape");
  await peek.waitFor({ state: "hidden", timeout: MAX }).catch(() => {});
  await settle();
}

// 2. State change from the peek (PERF row 0), cycling states; time to the peek's State combobox showing the new value.
const STATES = ["Todo", "In Progress", "Done", "Backlog", "Cancelled", "Todo"];
if (!ONLY) result.setup.stateListSettleMs = await openList(`${P}/work-items`);
if (!ONLY) {
  const item = rows[0];
  await page.getByRole("button", { name: item.key, exact: true }).filter({ visible: true }).first().click({ timeout: MAX });
  await peek.getByRole("heading", { name: item.name }).first().waitFor({ state: "visible", timeout: MAX });
  await settle();
  for (let i = 0; i < runs; i++) {
    const combo = peek.getByRole("combobox", { name: "State" }).first();
    const current = (await combo.textContent()) ?? "";
    const next = STATES.find((s) => !current.includes(s)) ?? "Todo";
    const tOpen = Date.now();
    await page.evaluate(() => window.__armFn(`return [...document.querySelectorAll('[role="option"]')].some((o) => o.checkVisibility())`));
    await combo.click({ timeout: MAX });
    const openDt = await waitNav();
    const option = page.getByRole("option").filter({ visible: true }).filter({ hasText: new RegExp(`^\\s*${next}\\s*$`) }).first();
    await option.waitFor({ state: "visible", timeout: MAX });
    await page.evaluate((name) => window.__armFn(`const first = [...document.querySelectorAll('[role="complementary"] [role="combobox"]')].filter((c) => c.checkVisibility())[0]; return !!first && first.textContent.trim() === ${JSON.stringify(name)}`), next);
    const t = Date.now();
    const action = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined, { timeout: MAX }).then(() => Date.now() - t, () => null);
    await option.click({ timeout: MAX });
    const dt = await waitNav();
    const actionMs = await action;
    const busy = await settle();
    result.stateChange.push({ from: current.trim().slice(0, 30), to: next, openDropdownDt: openDt, dt, actionRoundTripMs: actionMs, busyAfter: busy, reqs: since(tOpen) });
  }
  await page.keyboard.press("Escape");
}

// 3. Board "Move to": the first card of Backlog moves to Todo.
if (!ONLY) result.setup.boardSettleMs = await openList(`${P}/work-items?q=${q({ layout: "board", group_by: "state" })}`);
for (let i = 0; i < (ONLY ? 0 : runs); i++) {
  const from = i % 2 === 0 ? "Backlog" : "Todo";
  const to = i % 2 === 0 ? "Todo" : "Backlog";
  const column = page.locator(".tessera-board-column").filter({ has: page.getByRole("button", { name: `Add a work item to ${from}`, exact: true }) });
  const menuBtn = column.getByRole("button", { name: new RegExp(`^Actions for ${IDENT}-\\d+$`) }).first();
  const label = (await menuBtn.getAttribute("aria-label")) ?? (await menuBtn.textContent());
  const key = label.replace("Actions for ", "").trim();
  await menuBtn.click({ timeout: MAX });
  await page.getByRole("menuitem", { name: "Move to" }).click({ timeout: MAX });
  const target = page.getByRole("menuitem", { name: to, exact: true });
  await target.waitFor({ state: "visible", timeout: MAX });
  await page.evaluate(({ key, to }) => window.__armFn(`
    const cols = [...document.querySelectorAll('.tessera-board-column')];
    const col = cols.find((c) => c.querySelector('button[aria-label="Add a work item to ${to}"]'));
    if (!col) return false;
    return [...col.querySelectorAll('button[aria-label="Actions for ${key}"]')].some((b) => b.checkVisibility());`), { key, to });
  const t = Date.now();
  const action = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined, { timeout: MAX }).then(() => Date.now() - t, () => null);
  await target.click({ timeout: MAX });
  const dt = await waitNav();
  const actionMs = await action;
  const busy = await settle();
  result.boardMove.push({ key, from, to, dt, actionRoundTripMs: actionMs, busyAfter: busy, reqs: since(t) });
}

// 4. Quick add at the bottom of the ungrouped list.
if (!ONLY) result.setup.quickAddListSettleMs = await openList(`${P}/work-items`);
for (let i = 0; i < (ONLY ? 0 : runs); i++) {
  const name = `perf quick add ${Date.now()} ${i}`;
  const input = page.getByRole("textbox", { name: "New work item" });
  if (!(await input.isVisible())) await page.getByRole("button", { name: "New work item" }).filter({ visible: true }).last().click({ timeout: MAX });
  await input.waitFor({ state: "visible", timeout: MAX });
  await input.fill(name);
  await page.evaluate((name) => window.__armFn(`
    const it = document.evaluate("//*[text()=" + ${JSON.stringify(JSON.stringify(name))} + "]", document.querySelector('[data-list-ready]') ?? document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    return !!it && it.checkVisibility();`), name);
  const t = Date.now();
  const action = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined, { timeout: MAX }).then(() => Date.now() - t, () => null);
  await page.keyboard.press("Enter");
  const dt = await waitNav();
  const actionMs = await action;
  const busy = await settle();
  result.quickAdd.push({ name, dt, actionRoundTripMs: actionMs, busyAfter: busy, reqs: since(t) });
}
if (!ONLY) {
  await page.keyboard.press("Escape");
  await settle();
}

// 5. Power K on the list page: open, then search for a title no earlier step visited (not in recents).
const far = execSync(`sqlite3 -separator '|' ${DB} "select name from work_item where project_id='${project}' and archived_at is null and deleted_at is null order by sort_order limit 8 offset 5000"`).toString().trim().split("\n");
if (process.env.ONLY === "powerk") result.setup.powerKListSettleMs = await openList(`${P}/work-items`);
const mod = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control"));
const palette = page.getByRole("dialog", { name: "Command bar" });
for (let i = 0; i < runs; i++) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
  await page.evaluate(() => window.__armFn(`const t = document.querySelector('[aria-label="Command bar mode"]'); return !!t && t.checkVisibility()`));
  await page.keyboard.press(`${mod}+k`);
  const openDt = await waitNav();
  await palette.getByRole("combobox").waitFor({ state: "visible", timeout: MAX });
  const query = far[i];
  await page.evaluate((query) => window.__armFn(`const dlg = document.querySelector('[aria-label="Command bar mode"]')?.closest('[role="dialog"], dialog'); if (!dlg) return false; return [...dlg.querySelectorAll('[role="option"]')].some((o) => o.checkVisibility() && o.textContent.toLowerCase().includes(${JSON.stringify(query.toLowerCase())}))`), query);
  const t = Date.now();
  await page.keyboard.type(query);
  const typedMs = Date.now() - t;
  const dt = await waitNav();
  result.powerKOpen.push({ dt: openDt });
  result.powerKSearch.push({ query, dt, typingMs: typedMs, afterLastKey: dt === null ? null : dt - typedMs, reqs: since(t) });
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden", timeout: MAX }).catch(() => {});
  await settle();
}

result.loadAfter = load();
const sum = (xs, k = "dt") => ({ median: median(xs.map((x) => x[k])), p95: pct(xs.map((x) => x[k]), 95), n: xs.filter((x) => x[k] !== null).length });
result.summary = {
  peekOpen: { ...sum(result.peekOpen), rsc_ms: median(result.peekOpen.flatMap((x) => x.reqs.filter((r) => r.kind === "rsc").map((r) => r.ms))), rsc_kb: median(result.peekOpen.flatMap((x) => x.reqs.filter((r) => r.kind === "rsc").map((r) => r.kb))), busy_after: median(result.peekOpen.map((x) => x.busyAfter)) },
  stateDropdownOpen: sum(result.stateChange, "openDropdownDt"),
  stateChange: { ...sum(result.stateChange), action_ms: median(result.stateChange.map((x) => x.actionRoundTripMs)), busy_after: median(result.stateChange.map((x) => x.busyAfter)) },
  boardMove: { ...sum(result.boardMove), action_ms: median(result.boardMove.map((x) => x.actionRoundTripMs)), busy_after: median(result.boardMove.map((x) => x.busyAfter)) },
  quickAdd: { ...sum(result.quickAdd), action_ms: median(result.quickAdd.map((x) => x.actionRoundTripMs)), busy_after: median(result.quickAdd.map((x) => x.busyAfter)) },
  powerKOpen: sum(result.powerKOpen),
  powerKSearch: { ...sum(result.powerKSearch), typing_ms: median(result.powerKSearch.map((x) => x.typingMs)), after_last_key_ms: median(result.powerKSearch.map((x) => x.afterLastKey)), search_api_ms: median(result.powerKSearch.flatMap((x) => x.reqs.filter((r) => r.kind === 'api').map((r) => r.ms))) },
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`load before ${result.loadBefore} after ${result.loadAfter}`, result.setup);
console.log(JSON.stringify(result.summary, null, 1));
await browser.close();
