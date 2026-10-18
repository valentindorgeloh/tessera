import { describe, expect, it } from "vitest";
import { formatEstimateValue } from "@/components/estimates/estimate-format";

describe("formatEstimateValue", () => {
  it("prints time as hours and minutes and leaves other types as text", () => {
    expect(formatEstimateValue("time", "90")).toBe("1h 30m");
    expect(formatEstimateValue("time", "60")).toBe("1h");
    expect(formatEstimateValue("time", "15")).toBe("15m");
    expect(formatEstimateValue("points", "5")).toBe("5");
    expect(formatEstimateValue("categories", "Large")).toBe("Large");
  });
});
