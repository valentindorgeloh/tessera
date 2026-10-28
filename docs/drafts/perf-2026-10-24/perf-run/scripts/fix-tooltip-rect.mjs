// FIXER: the settled box and styles of the list title's overflow tooltip (1 s after hover), to compare two builds.
// Usage: node fix-tooltip-rect.mjs <port>
import { chromium } from "@playwright/test";
const [port] = process.argv.slice(2);
const WEB = "01a160df-642f-7102-859a-8c50a72e7f1e";
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/projects/${WEB}/work-items?q=${q({ group_by: "state" })}`, { waitUntil: "networkidle" });
const title = page.locator(".tessera-wi-title", { hasText: "A deliberately very long" }).first();
await title.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await title.hover();
await page.waitForTimeout(1200);
const r = await page.evaluate(() => {
  const tip = [...document.querySelectorAll('[role="tooltip"]')].find((t) => t.checkVisibility());
  if (!tip) return null;
  const b = tip.getBoundingClientRect();
  const cs = getComputedStyle(tip);
  const inner = tip.firstElementChild;
  return { box: [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10) / 10), opacity: cs.opacity, maxWidth: cs.maxWidth, innerHTML: tip.innerHTML.replace(/class="[^"]*"/g, "class").slice(0, 200) };
});
console.log(JSON.stringify(r));
await browser.close();
