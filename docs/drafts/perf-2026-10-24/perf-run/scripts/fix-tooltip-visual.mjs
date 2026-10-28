// FIXER: (1) screenshots of the list, table and gantt around a long-titled item, at 1440 and 480, Frappé and Latte,
// for a pixel diff between two builds (lane-rows-pixdiff.mjs); (2) at 1440, the overflow tooltip of the cut title in
// each layout: hover (mouse) -> a visible [role=tooltip] with the full title, Escape hides it, leaving hides it, and a
// title that fits ("Short") opens none. Console errors are collected.
// Usage: node fix-tooltip-visual.mjs <port> <outDir> <label>
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [port, outDir, label] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const BASE = `http://127.0.0.1:${port}`;
const WEB = "01a160df-642f-7102-859a-8c50a72e7f1e";
const LONG = "A deliberately very long work item title";
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");
const LIST = `/projects/${WEB}/work-items`;
const SCREENS = [
  { name: "list", path: `${LIST}?q=${q({ group_by: "state" })}`, ready: "[data-list-ready]", title: ".tessera-wi-title" },
  { name: "table", path: `${LIST}?q=${q({ layout: "table", group_by: "state" })}`, ready: "[data-list-ready]", title: 'td :is(.tessera-wi-cell-text, [class*="astryx-text"])' },
  { name: "gantt", path: `${LIST}?q=${q({ layout: "gantt" })}`, ready: ".tessera-gantt-row", title: ".tessera-gantt-name" },
];
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 480: { width: 480, height: 900 } };
const browser = await chromium.launch();
const out = { label, shots: [], tooltips: [] };
for (const scheme of ["frappe", "latte"]) {
  for (const s of SCREENS) {
    for (const w of [1440, 480]) {
      const ctx = await browser.newContext({ viewport: VIEWPORTS[w] });
      if (scheme === "latte") await ctx.addInitScript(() => { try { localStorage.setItem("tessera.scheme.v1", "light"); } catch {} });
      const page = await ctx.newPage();
      const errs = [];
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
      page.on("pageerror", (e) => errs.push(`pageerror: ${String(e).slice(0, 160)}`));
      await page.goto(BASE + s.path, { waitUntil: "networkidle", timeout: 120000 });
      await page.locator(s.ready).filter({ visible: true }).first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(1200);
      const long = page.locator(s.title, { hasText: LONG }).filter({ visible: true }).first();
      await long.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => null);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${outDir}/${scheme}-${s.name}-${w}.png` });
      const shot = { scheme, screen: s.name, width: w, errors: errs.length ? errs : undefined };
      if (scheme === "frappe" && w === 1440) {
        const tip = async () => page.evaluate(() => [...document.querySelectorAll('[role="tooltip"]')].filter((t) => t.checkVisibility()).map((t) => t.textContent));
        const r = { screen: s.name };
        r.cut = await long.evaluate((el) => ({ tag: el.tagName, cls: el.className.slice(0, 80), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, cut: el.scrollWidth > el.clientWidth, display: getComputedStyle(el).display, textOverflow: getComputedStyle(el).textOverflow }));
        r.tipsBefore = await tip();
        await long.hover();
        const t0 = Date.now();
        let shown = [];
        while (Date.now() - t0 < 1500) { shown = await tip(); if (shown.some((t) => t?.startsWith(LONG))) break; await page.waitForTimeout(20); }
        r.hoverToTipMs = shown.some((t) => t?.startsWith(LONG)) ? Date.now() - t0 : null;
        r.tipText = shown.find((t) => t?.startsWith(LONG)) ?? null;
        await page.screenshot({ path: `${outDir}/tooltip-${s.name}.png` });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        r.afterEscape = await tip();
        await page.mouse.move(1, 1);
        await page.waitForTimeout(300);
        r.afterLeave = await tip();
        const short = page.locator(s.title, { hasText: /^Short$/ }).filter({ visible: true }).first();
        if (await short.count()) {
          await short.hover();
          await page.waitForTimeout(700);
          r.shortCut = await short.evaluate((el) => el.scrollWidth > el.clientWidth);
          r.shortTips = await tip();
          await page.mouse.move(1, 1);
        }
        r.errors = errs.length ? errs : undefined;
        out.tooltips.push(r);
      }
      out.shots.push(shot);
      await ctx.close();
    }
  }
}
await browser.close();
fs.writeFileSync(`${outDir}/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.tooltips, null, 1));
console.log("shots with console messages:", out.shots.filter((s) => s.errors).length);
