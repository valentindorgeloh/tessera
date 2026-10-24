// Keeps one dev tab open on :3844 and counts full navigations / HMR events while a second process (the shell) runs `next build` in the same tree.
// Usage: node tab-vs-build.mjs <seconds>
import { chromium } from "/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf-research/runtime/tree/node_modules/playwright/index.mjs";
const secs = Number(process.argv[2] ?? 60);
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
let navs = 0; const msgs = [];
page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs++; });
page.on("console", (m) => { const t = m.text(); if (/HMR|reload|Fast Refresh|hash mismatch|Rebuilding/i.test(t)) msgs.push(t.slice(0, 120)); });
await page.goto("http://127.0.0.1:3844/inbox", { waitUntil: "load" });
const startNavs = navs;
console.log("TAB READY", new Date().toISOString());
await page.waitForTimeout(secs * 1000);
console.log(JSON.stringify({ fullNavigationsAfterLoad: navs - startNavs, hmrMessages: msgs.slice(0, 10), url: page.url() }));
await browser.close();
