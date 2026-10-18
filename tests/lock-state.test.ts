import { describe, expect, it } from "vitest";
import { nextLockFeedback } from "@/components/shared/lock-state";

describe("nextLockFeedback", () => {
  it("shows the unlocked feedback when a locked item is unlocked", () => {
    expect(nextLockFeedback(true, false, "idle")).toBe("unlocked");
  });

  it("clears the feedback when the item is locked again", () => {
    expect(nextLockFeedback(false, true, "unlocked")).toBe("idle");
  });

  it("keeps the current feedback while the state does not change", () => {
    expect(nextLockFeedback(false, false, "unlocked")).toBe("unlocked");
    expect(nextLockFeedback(false, false, "idle")).toBe("idle");
    expect(nextLockFeedback(true, true, "idle")).toBe("idle");
  });
});
