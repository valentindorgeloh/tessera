/** Explicit clears of the filter bar (src/components/work-items/filter-state.ts). */
import { describe, expect, it } from "vitest";
import { withExplicitClears } from "@/components/work-items/filter-state";
import type { Filters } from "@/lib/tessera/types";

const STATE_ID = "019505a0-7c5e-7000-8000-000000000001";
const LABEL_ID = "019505a0-7c5e-7000-8000-000000000002";

describe("withExplicitClears", () => {
  it("writes an empty list for every list key the effective filters carry and the next state drops", () => {
    const current: Filters = { state: [STATE_ID], priority: ["high"], search: "login" };
    expect(withExplicitClears(current, {})).toEqual({ state: [], priority: [], search: "" });
  });

  it("keeps the keys the next state still names", () => {
    const current: Filters = { state: [STATE_ID], labels: [LABEL_ID] };
    expect(withExplicitClears(current, { state: [STATE_ID] })).toEqual({ state: [STATE_ID], labels: [] });
  });

  it("does not invent clears for keys that were not set", () => {
    expect(withExplicitClears({}, {})).toEqual({});
    expect(withExplicitClears({ state: [] }, {})).toEqual({});
    expect(withExplicitClears({ search: "" }, {})).toEqual({});
  });

  it("leaves unmanaged keys and date filters as the next state has them", () => {
    const current: Filters = { parent: [STATE_ID], target_date: { op: "before", to: "2026-12-31" }, state: [STATE_ID] };
    expect(withExplicitClears(current, { parent: [STATE_ID] })).toEqual({ parent: [STATE_ID], state: [] });
  });
});
