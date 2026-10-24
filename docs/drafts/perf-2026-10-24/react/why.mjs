// Why did these components render? Compares props with the alternate fiber for named components. Usage: node why.mjs <port> <projectId> <scenario>
import { newPage, gotoReady } from "./lib.mjs";
const port = process.argv[2] ?? "3845";
const PID = process.argv[3] ?? "01a160df-642f-7102-859a-8c50a72e7f1e";
const scenario = process.argv[4] ?? "state";
const { browser, page } = await newPage({ cpu: 1 });
await page.addInitScript(() => {
  const W = window;
  W.__why = [];
  W.__whyOn = false;
  const hook = W.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const orig = hook.onCommitFiberRoot.bind(hook);
  const names = new Set(["WorkItemRow", "RowProperties", "StateControl", "ListItem", "GroupSection", "ListLayout", "WorkItemsScreen", "ProjectScope"]);
  hook.onCommitFiberRoot = (id, root) => {
    if (W.__whyOn) {
      const stack = [root.current];
      const seen = {};
      while (stack.length) {
        const f = stack.pop();
        const t = f.type;
        const name = t && (t.displayName || t.name || (t.type && t.type.name));
        if (f.flags & 1 && name && names.has(name)) {
          const a = f.alternate;
          const cur = f.memoizedProps || {};
          const prev = (a && a.memoizedProps) || {};
          const keys = Object.keys(cur).filter((k) => cur[k] !== prev[k]);
          const ctx = [];
          let d = f.dependencies && f.dependencies.firstContext;
          let ad = a && a.dependencies && a.dependencies.firstContext;
          while (d) {
            const changed = ad && ad.memoizedValue !== d.memoizedValue;
            if (changed) { const v = d.memoizedValue; ctx.push("CHANGED:" + (d.context.displayName || d.context._debugLabel || "") + ":" + (v && typeof v === "object" ? Object.keys(v).slice(0, 6).join("|") : String(v))); }
            d = d.next; ad = ad && ad.next;
          }
          const key = `${name} changedProps=[${keys.join(",")}] ctx=[${ctx.join(" ; ")}]`;
          seen[key] = (seen[key] || 0) + 1;
        }
        if (f.child && (f.subtreeFlags & 1 || f.tag === 3)) { let c = f.child; while (c) { stack.push(c); c = c.sibling; } }
      }
      if (Object.keys(seen).length) W.__why.push(seen);
    }
    return orig(id, root);
  };
});
await gotoReady(page, `http://127.0.0.1:${port}/projects/${PID}/work-items`);
await page.evaluate(() => window.__settle(1500, 60000));
await page.evaluate(() => { window.__arm({ sel: "body" }); window.__whyOn = true; });
if (scenario === "state") {
  const row = page.locator(".tessera-wi-row").nth(7);
  await row.locator("[role=combobox]").first().click();
  await page.locator("[role=listbox]:visible [role=option]").first().waitFor({ state: "visible" });
  await page.locator("[role=listbox]:visible [role=option]").nth(Number(process.env.OPT ?? 2)).click();
} else if (scenario === "peek") {
  await page.locator(".tessera-wi-row").nth(5).locator(".tessera-wi-open").click();
  await page.locator(".tessera-peek-panel .astryx-heading").first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(6000);
  console.log("--- closing peek");
  await page.evaluate(() => { window.__why.push({ "-- close": 1 }); });
  await page.keyboard.press("Escape");
} else if (scenario === "full") {
  const mark = (m) => page.evaluate((x) => { window.__why.push({ [`-- ${x}`]: 1 }); }, m);
  const row = (n) => page.locator(".tessera-wi-row").nth(n);
  await mark("select"); await row(3).locator(".tessera-wi-select").first().click({ force: true }); await page.waitForTimeout(3000);
  await mark("deselect"); await row(3).locator(".tessera-wi-select").first().click({ force: true }); await page.waitForTimeout(3000);
  await mark("peek-open"); await row(5).locator(".tessera-wi-open").click();
  await page.locator(".tessera-peek-panel .astryx-heading").first().waitFor({ state: "visible", timeout: 60000 }); await page.waitForTimeout(6000);
  await mark("peek-close"); await page.keyboard.press("Escape"); await page.waitForTimeout(1500);
  await mark("state-pick");
  await row(7).locator("[role=combobox]").first().click();
  await page.locator("[role=listbox]:visible [role=option]").first().waitFor({ state: "visible" });
  await page.locator("[role=listbox]:visible [role=option]").nth(2).click();
  await page.waitForTimeout(8000);
} else if (scenario === "select") {
  await page.locator(".tessera-wi-row").nth(3).locator(".tessera-wi-select").first().click({ force: true });
}
await page.waitForTimeout(scenario === "peek" ? 12000 : scenario === "full" ? 100 : 5000);
const why = await page.evaluate(() => window.__why);
const sizes = await page.evaluate(() => window.__rc.log.map((l) => l[1]));
console.log("COMMIT SIZES", JSON.stringify(sizes));
why.forEach((w, i) => console.log("commit", i, JSON.stringify(w)));
await browser.close();
