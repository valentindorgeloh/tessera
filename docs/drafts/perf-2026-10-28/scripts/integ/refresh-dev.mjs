// External write while the small project's list is visible, on the dev server (component names). Usage: node refresh-dev.mjs <port> <tag> <itemId>
import fs from "node:fs";
import { execSync } from "node:child_process";
import { newPage, gotoReady, load, cpuProbe } from "./lib.mjs";
const port = process.argv[2] ?? "3845";
const tag = process.argv[3] ?? "refresh-dev";
const ITEM = process.argv[4];
const PID = process.env.PID ?? "01a160df-642f-7102-859a-8c50a72e7f1e";
const TREE = process.env.TREE;
const DB = process.env.DBP;
const { browser, page } = await newPage({ cpu: 1 });
const cp = await cpuProbe(browser);
const out = {};
console.log("load", load());
await gotoReady(page, `http://127.0.0.1:${port}/projects/${PID}/work-items`);
await page.waitForTimeout(6000);
await page.evaluate(() => window.__settle(1500, 60000));
for (let i = 0; i < Number(process.env.N ?? 3); i++) {
  const mark = `dev${i}${Date.now() % 10000}`;
  await page.evaluate((m) => window.__arm({ sel: ".tessera-wi-row", text: m }), mark);
  const c0 = await cp.read();
  execSync(`npx tsx scripts/mcp-call.ts --client react-probe update_work_item '${JSON.stringify({ work_item_id: ITEM, name: `Investigate importer ${mark}` })}'`, { cwd: TREE, env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}`, TESSERA_DB_PATH: DB }, stdio: "ignore" });
  await page.evaluate(() => window.__markT0());
  await page.waitForFunction(() => window.__armed && window.__armed.ready !== null, null, { timeout: 60000 }).catch(() => {});
  const c1 = await cp.read();
  await page.evaluate(() => window.__settle(1500, 60000));
  const r = await page.evaluate(() => window.__collect());
  console.log("external-write", i, JSON.stringify({ commits: r.commits, worked: r.worked, cpuReady: Math.round(c1 - c0), top: r.topTypes.slice(0, 6).map((t) => t.join("=")).join(" ") }));
  (out.refresh ??= []).push({ ...r, cpuMs: Math.round(c1 - c0) });
}
fs.writeFileSync(new URL(`./out-${tag}.json`, import.meta.url).pathname, JSON.stringify(out, null, 1));
await browser.close();
