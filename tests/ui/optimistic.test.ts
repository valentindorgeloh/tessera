/** Quick-add placeholder ids (src/components/work-items/optimistic.ts). */
import { describe, expect, it } from "vitest";
import { OPTIMISTIC_ID_PREFIX, isOptimisticId, optimisticId } from "@/components/work-items/optimistic";

describe("optimistic ids", () => {
  it("makes unique ids that the check recognises", () => {
    const a = optimisticId();
    const b = optimisticId();
    expect(a).not.toBe(b);
    expect(a.startsWith(OPTIMISTIC_ID_PREFIX)).toBe(true);
    expect(isOptimisticId(a)).toBe(true);
    expect(isOptimisticId(b)).toBe(true);
  });

  it("does not match engine ids", () => {
    expect(isOptimisticId("11111111-1111-7111-8111-111111111111")).toBe(false);
    expect(isOptimisticId("")).toBe(false);
  });
});
