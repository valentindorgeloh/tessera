// MEASURE-CODE: functional check that a list-row date chip still opens its picker. Usage: node code-date-open-check.mjs <port> <path>
import { chromium } from "@playwright/test";
const [port, path] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-list-ready]");
await page.waitForTimeout(1000);
const chip = page.locator("[data-list-ready] button.tessera-wi-chip").first();
const label = await chip.getAttribute("aria-label");
const t0 = Date.now();
await chip.click();
await page.waitForSelector('[popover]:popover-open input, [popover]:popover-open [role="group"], [popover]:popover-open button', { timeout: 10000 }).catch(() => null);
const open = await page.evaluate(() => [...document.querySelectorAll("[popover]")].filter((p) => p.matches(":popover-open")).map((p) => ({ role: p.getAttribute("role"), text: p.textContent.trim().slice(0, 60), focused: p.contains(document.activeElement) })));
console.log(JSON.stringify({ chip: label, openMs: Date.now() - t0, open, errors: errors.slice(0, 5) }, null, 1));
await browser.close();
