import { chromium } from "playwright"; import { SETS } from "./common.mjs";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 375, height: 812 } }); const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${SETS.small.port}/inbox`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
console.log(await page.evaluate(() => { const m = document.querySelector('[role="main"]'); return { tabs: [...m.querySelectorAll('[role="tab"]')].map((t) => [t.innerText.slice(0, 12), t.checkVisibility(), t.getBoundingClientRect().width]), main: m.checkVisibility(), mainCount: document.querySelectorAll('[role="main"]').length, lis: [...m.querySelectorAll("li")].slice(0, 3).map((l) => [l.innerText.slice(0, 20), l.checkVisibility()]) }; }));
await b.close();
