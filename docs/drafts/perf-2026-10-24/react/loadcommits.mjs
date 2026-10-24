// Per-commit component histograms during page load (dev, component names). Usage: node loadcommits.mjs <port> <projectId> <tag>
import fs from "node:fs";
import { newPage, load } from "./lib.mjs";
const port = process.argv[2] ?? "3845";
const PID = process.argv[3] ?? "01a160df-642f-7102-859a-8c50a72e7f1e";
const tag = process.argv[4] ?? "loadcommits";
const { browser, page } = await newPage({ cpu: 1, fromStart: true });
console.log("load", load());
await page.goto(`http://127.0.0.1:${port}/projects/${PID}/work-items`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-list-ready]", { state: "attached", timeout: 240000 });
await page.evaluate(() => window.__settle(2000, 120000));
const r = await page.evaluate(() => window.__rc.log.filter((l) => l[1] > 300));
for (const [t, n, top] of r) console.log(t, n, JSON.stringify(top.map((x) => x.join("=")).join(" ")));
fs.writeFileSync(new URL(`./out-${tag}.json`, import.meta.url).pathname, JSON.stringify(r, null, 1));
await browser.close();
