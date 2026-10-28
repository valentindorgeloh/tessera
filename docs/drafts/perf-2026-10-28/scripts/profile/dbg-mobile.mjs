import { chromium } from "playwright";
import { SETS } from "./common.mjs";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 375, height: 812 } }); const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${SETS.small.port}/`, { waitUntil: "load" }); await page.waitForTimeout(2500);
const btns = await page.getByRole("button").all();
for (const x of btns.slice(0, 12)) console.log(await x.getAttribute("aria-label"), "|", (await x.innerText()).slice(0, 20), "|", await x.isVisible());
const n = await page.locator('a[href="/inbox"]').all(); for (const a of n) console.log("inbox link visible", await a.isVisible());
await b.close();
