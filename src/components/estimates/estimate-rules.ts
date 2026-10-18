/**
 * Client checks for an estimate system's values, matching the engine's rules.
 * Pure, so the dialog and Vitest share it (tests/ui/estimate-rules.test.ts).
 */
import { ESTIMATE_POINTS_MAX, ESTIMATE_POINTS_MIN } from "@/lib/tessera/schemas";
import type { EstimateType } from "@/lib/tessera/types";

/** A sentence when the values break the type's rules, otherwise null. */
export function estimateValuesError(type: EstimateType, values: readonly string[]): string | null {
  if (values.length < ESTIMATE_POINTS_MIN || values.length > ESTIMATE_POINTS_MAX) {
    return `An estimate system has ${ESTIMATE_POINTS_MIN} to ${ESTIMATE_POINTS_MAX} values`;
  }
  if (type === "categories") {
    const seen = new Set<string>();
    for (const value of values) {
      const trimmed = value.trim();
      if (trimmed.length < 1 || trimmed.length > 24) return "A category is 1 to 24 characters";
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return `Duplicate category "${trimmed}"`;
      seen.add(key);
    }
    return null;
  }
  const numbers: number[] = [];
  for (const value of values) {
    const parsed = parseTyped(type, value.trim());
    if (typeof parsed === "string") return parsed;
    numbers.push(parsed);
  }
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] <= numbers[i - 1]) return "Values must be strictly ascending";
  }
  return null;
}

function parseTyped(type: EstimateType, value: string): number | string {
  if (type === "time") {
    if (!/^\d+$/.test(value)) return "Time values are whole minutes";
    const n = Number(value);
    if (n < 1 || n > 10_080) return "Time values are between 1 and 10080 minutes";
    return n;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return "Point values are numbers with at most two decimals";
  return Number(value);
}
