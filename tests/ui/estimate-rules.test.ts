import { describe, expect, it } from "vitest";
import { estimateValuesError } from "@/components/estimates/estimate-rules";

describe("estimateValuesError", () => {
  it("accepts ascending points and rejects duplicates, ranges and order", () => {
    expect(estimateValuesError("points", ["1", "2", "3", "5"])).toBeNull();
    expect(estimateValuesError("points", ["1"])).toMatch(/2 to 6/);
    expect(estimateValuesError("points", ["2", "2"])).toMatch(/ascending/);
    expect(estimateValuesError("points", ["1", "1.234"])).toMatch(/decimals/);
    expect(estimateValuesError("categories", ["S", "s"])).toMatch(/Duplicate/);
    expect(estimateValuesError("time", ["30", "90"])).toBeNull();
    expect(estimateValuesError("time", ["0", "30"])).toMatch(/minutes/);
  });
});
