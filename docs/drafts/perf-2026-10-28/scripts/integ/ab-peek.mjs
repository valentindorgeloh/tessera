// A/B (interleaved) first-peek probe on two production servers, after peek-probe.mjs.
// Usage: node ab-peek.mjs <portA> <portB> <small|large> <delayMsAfterLoad> <n> <outFile>
// Per sample: fresh context (cold cache), desktop 1440x900, no CPU throttle. Wait <delay> after the load event, press the
// 3rd row's open control (click again after 1.2 s while the URL has no peek=: before hydration a click is dropped), then
// record scripts requested after the first press (count, encoded KB) and press -> visible editor (contenteditable).
import fs from "node:fs";
import os from "node:os";
import { chromium } from "playwright";

const [portA, portB, db, delayArg, nArg, outFile] = process.argv.slice(2);
const delay = Number(delayArg), n = Number(nArg);
const PROJECT = db === "large" ? "01a16ad8-6ddd-7752-91fa-653ae8b8a394" : "01a160df-642f-7102-859a-8c50a72e7f1e";
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const load = () => os.loadavg().map((x) => x.toFixed(1)).join(" ");
const browser = await chromium.launch();

async function sample(port) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  let armed = false; const after = new Map(); const types = new Map();
  cdp.on("Network.requestWillBeSent", (e) => { if (armed && e.type === "Script") after.set(e.requestId, { url: e.request.url, kb: 0 }); });
  cdp.on("Network.loadingFinished", (e) => { const r = after.get(e.requestId); if (r) r.kb = e.encodedDataLength / 1024; });
  await page.addInitScript(() => {
    const T = (window.__t = { t0: null, frozen: false, ready: null, downs: 0 });
    document.addEventListener("pointerdown", (ev) => { if (!T.frozen) { T.t0 = ev.timeStamp; T.downs++; } }, { capture: true });
    const vis = (e) => e && e.checkVisibility && e.checkVisibility();
    const tick = () => {
      if (!T.frozen && location.search.includes("peek=") && T.t0 !== null) T.frozen = true;
      if (T.frozen && T.ready === null && [...document.querySelectorAll('.tessera-peek-panel [contenteditable="true"]')].some(vis)) T.ready = Math.round(performance.now() - T.t0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`http://127.0.0.1:${port}/projects/${PROJECT}/work-items`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(delay);
  const open = page.locator("li.tessera-wi-row .tessera-wi-open").nth(2);
  await open.waitFor({ state: "visible", timeout: 60_000 });
  armed = true;
  let clicks = 0;
  for (; clicks < 6; ) {
    clicks++;
    await open.click({ force: true, timeout: 20_000 }).catch(() => {});
    const ok = await page.waitForFunction(() => location.search.includes("peek="), null, { timeout: 1200, polling: 25 }).then(() => true).catch(() => false);
    if (ok) break;
  }
  await page.waitForFunction(() => window.__t.ready !== null, null, { timeout: 30_000, polling: 25 }).catch(() => null);
  await page.waitForTimeout(600);
  const ready = await page.evaluate(() => window.__t.ready);
  const scripts = [...after.values()];
  await ctx.close();
  return { clicks, clickToEditorMs: ready ?? -1, scriptsAfterPress: scripts.length, scriptKBAfterPress: Math.round(scripts.reduce((s, x) => s + x.kb, 0)), urls: scripts.map((x) => x.url.split("/").pop()) };
}

const A = [], B = [];
await sample(portA); await sample(portB);
for (let i = 0; i < n; i++) { A.push(await sample(portA)); B.push(await sample(portB)); }
const med = (arr) => Object.fromEntries(["clicks", "clickToEditorMs", "scriptsAfterPress", "scriptKBAfterPress"].map((k) => [k, median(arr.map((x) => x[k]))]));
const out = { at: new Date().toISOString(), db, delay, n, load: load(), A: med(A), B: med(B), samplesA: A, samplesB: B };
console.log(`delay ${delay} ${db}`, "A", JSON.stringify(out.A), "B", JSON.stringify(out.B));
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
await browser.close();
