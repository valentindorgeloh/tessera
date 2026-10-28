// MEASURE-CODE: background CPU of a `next dev` server per client navigation: samples the process tree under the dev
// server every 100 ms while a browser does N sidebar navigations, then reports CPU time per process (by role) and how
// many short-lived static-paths workers were forked.
// Usage: node code-dev-bg-cpu.mjs <port> <navs> <out.json>
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
const [port, navsArg, out] = process.argv.slice(2);
const navs = Number(navsArg ?? 5);
const BASE = `http://127.0.0.1:${port}`;
const rootPid = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`).toString().trim().split("\n")[0];
const parse = (t) => { const [m, s] = t.split(":"); return Number(m) * 60 + Number(s); };
function tree() {
  const rows = execSync("ps -A -o pid=,ppid=,time=,command=").toString().trim().split("\n").map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return { pid: m[1], ppid: m[2], cpu: parse(m[3]), cmd: m[4] };
  });
  const byPpid = new Map();
  for (const r of rows) (byPpid.get(r.ppid) ?? byPpid.set(r.ppid, []).get(r.ppid)).push(r);
  // Walk up from the listening server to its `next dev` parent, then collect every descendant.
  const all = new Map(rows.map((r) => [r.pid, r]));
  let top = all.get(rootPid);
  while (top && all.get(top.ppid) && /next/.test(all.get(top.ppid).cmd)) top = all.get(top.ppid);
  const res = [];
  const stack = [top];
  while (stack.length) { const p = stack.pop(); if (!p) continue; res.push(p); for (const c of byPpid.get(p.pid) ?? []) stack.push(c); }
  return res;
}
const role = (cmd) => /static-paths-worker|processChild/.test(cmd) ? "jest-worker child" : /validation/i.test(cmd) ? "validation worker" : /next-server/.test(cmd) ? "next-server" : /next dev/.test(cmd) ? "next dev" : cmd.slice(0, 80);
const seen = new Map();
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    for (const p of tree()) {
      const prev = seen.get(p.pid);
      if (!prev) seen.set(p.pid, { first: p.cpu, last: p.cpu, cmd: p.cmd });
      else prev.last = p.cpu;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
})();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE + "/inbox", { waitUntil: "networkidle", timeout: 180000 });
await page.waitForTimeout(3000);
const startCpu = new Map([...seen].map(([pid, v]) => [pid, v.last]));
const PROJECT = process.env.PROJECT ?? "01a160df-642f-7102-859a-8c50a72e7f1e";
// Dynamic routes (work-items, your-work/[tab], analytics/[tab]) alternate with a static one (/inbox).
const targets = [`a[href="/projects/${PROJECT}/work-items"]`, 'a[href="/inbox"]', 'a[href="/your-work"]', 'a[href="/inbox"]', 'a[href="/analytics"]', 'a[href="/inbox"]'];
const t0 = Date.now();
for (let i = 0; i < navs; i++) {
  await page.locator(targets[i % targets.length]).first().click();
  await page.waitForLoadState("networkidle").catch(() => null);
  await page.waitForTimeout(1500);
}
const wall = Date.now() - t0;
await page.waitForTimeout(3000);
sampling = false;
await sampler;
await browser.close();
const byRole = {};
let forked = 0;
for (const [pid, v] of seen) {
  const base = startCpu.get(pid);
  const used = base === undefined ? v.last : v.last - base;
  if (base === undefined) forked++;
  const r = role(v.cmd) + (base === undefined ? " (forked during navs)" : " (already running)");
  byRole[r] = byRole[r] ?? { procs: 0, newProcs: 0, cpuS: 0 };
  byRole[r].procs++;
  if (base === undefined) byRole[r].newProcs++;
  byRole[r].cpuS = Math.round((byRole[r].cpuS + used) * 100) / 100;
}
const res = { port, navs, wallMs: wall, newProcessesDuringNavs: forked, byRole, load: execSync("uptime").toString().trim() };
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(out, JSON.stringify(res, null, 2));
