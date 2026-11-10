import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The shared motion classes (src/components/styles/motion.css) in the real
 * stylesheet, on a probe element added to a live page, with motion ON.
 * The helpers behind them (playExit, useEnterFlag) have jsdom tests in
 * tests/ui/motion-helpers.test.ts; lanes that use them add their own specs.
 *
 * An enter runs 225 ms (--duration-medium-min) on --ease-entrance, an exit
 * 140 ms (--duration-exit) on --ease-exit and holds the surface out
 * (`forwards`); under Reduce Motion no Tessera rule runs an animation.
 */

type Probe = { names: string[]; durations: string[]; ease: string[]; fill: string[]; running: number };

/** Adds `<section class="tessera-motion-slide-end" ...attrs>` to the page and reads what the browser makes of it. */
async function probe(page: Page, className: string, attribute: string): Promise<Probe> {
  return page.evaluate(
    ([cls, attr]) => {
      document.querySelectorAll("#motion-probe").forEach((node) => node.remove());
      const element = document.createElement("section");
      element.id = "motion-probe";
      element.className = cls;
      element.setAttribute(attr, "");
      document.body.append(element);
      const style = getComputedStyle(element);
      const list = (value: string) => value.split(",").map((part) => part.trim());
      return {
        names: list(style.animationName),
        durations: list(style.animationDuration),
        ease: list(style.animationTimingFunction),
        fill: list(style.animationFillMode),
        running: element.getAnimations().length,
      };
    },
    [className, attribute],
  );
}

test.describe("motion on", () => {
  test.use({ reducedMotion: "no-preference" });

  test("a surface that entered runs the slide in for 225 ms", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("main")).toBeVisible();
    const slide = await probe(page, "tessera-motion-slide-end", "data-enter");
    expect(slide).toMatchObject({ names: ["tessera-slide-in-end"], durations: ["0.225s"], fill: ["backwards"], running: 1 });
    const fade = await probe(page, "tessera-motion-fade", "data-enter");
    expect(fade).toMatchObject({ names: ["tessera-fade-in"], durations: ["0.175s"], fill: ["backwards"], running: 1 });
    const rise = await probe(page, "tessera-motion-rise", "data-enter");
    expect(rise).toMatchObject({ names: ["tessera-rise"], durations: ["0.175s"], running: 1 });
    // Without the attribute (a hydrated surface, a deep link) nothing runs.
    const idle = await page.evaluate(() => {
      const element = document.createElement("section");
      element.className = "tessera-motion-slide-end";
      document.body.append(element);
      const names = getComputedStyle(element).animationName;
      element.remove();
      return names;
    });
    expect(idle).toBe("none");
  });

  test("an exit runs 140 ms and holds the surface out until it unmounts", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("main")).toBeVisible();
    const exit = await probe(page, "tessera-motion-slide-end", "data-exiting");
    expect(exit).toMatchObject({ names: ["tessera-slide-out-end"], durations: ["0.14s"], fill: ["forwards"], running: 1 });
    // After the end the forwards fill keeps it translated out and transparent.
    await page.waitForFunction(() => document.getElementById("motion-probe")!.getAnimations().every((animation) => animation.playState === "finished"));
    const held = await page.evaluate(() => {
      const style = getComputedStyle(document.getElementById("motion-probe")!);
      return { translate: style.translate, opacity: style.opacity };
    });
    expect(held.opacity).toBe("0");
    expect(held.translate).not.toBe("none");
    expect(held.translate.startsWith("0px")).toBe(false);
  });

  test("an exit that was started and then cancelled leaves nothing behind", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("main")).toBeVisible();
    // Activity hides a route with display: none: the running animation is cancelled, and removing the attribute ends the hold.
    const result = await page.evaluate(async () => {
      const element = document.createElement("section");
      element.className = "tessera-motion-slide-end";
      element.setAttribute("data-exiting", "");
      document.body.append(element);
      const [animation] = element.getAnimations();
      const cancelled = animation.finished.then(
        () => "finished",
        (error: DOMException) => error.name,
      );
      element.style.display = "none";
      const outcome = await cancelled;
      element.removeAttribute("data-exiting");
      element.style.display = "";
      const names = getComputedStyle(element).animationName;
      element.remove();
      return { outcome, names };
    });
    expect(result).toEqual({ outcome: "AbortError", names: "none" });
  });
});

test.describe("Reduce Motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no Tessera motion class runs an animation", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("main")).toBeVisible();
    for (const [className, attribute] of [
      ["tessera-motion-slide-end", "data-enter"],
      ["tessera-motion-slide-end", "data-exiting"],
      ["tessera-motion-fade", "data-enter"],
      ["tessera-motion-fade", "data-exiting"],
      ["tessera-motion-rise", "data-enter"],
    ]) {
      expect(await probe(page, className, attribute), `${className} ${attribute}`).toMatchObject({ names: ["none"], running: 0 });
    }
  });
});
