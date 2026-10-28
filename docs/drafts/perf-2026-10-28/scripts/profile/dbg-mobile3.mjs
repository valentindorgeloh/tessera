import { chromium } from "playwright";
import { SETS } from "./common.mjs";
const b = await chromium.launch();
for (const w of [375, 1440]) for (const p of ["/inbox", "/analytics/overview", "/analytics"]) {
const ctx = await b.newContext({ viewport: { width: w, height: 812 } }); const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${SETS.small.port}${p}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
const r = await page.evaluate(() => { const m = document.querySelector('[role="main"]'); const hs = [...m.querySelectorAll("h1,h2,h3,h4,h5")].map((h) => h.tagName + ":" + h.innerText.slice(0, 30)); return { url: location.pathname, hs: hs.slice(0, 8), skel: m.querySelectorAll(".astryx-skeleton").length, links: m.querySelectorAll("a").length, li: m.querySelectorAll("li").length, text: m.innerText.slice(0, 80).replace(/\n/g, " | ") }; });
console.log(w, p, JSON.stringify(r)); await ctx.close(); }
await b.close();
