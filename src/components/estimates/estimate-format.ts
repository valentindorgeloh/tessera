/**
 * Display of an estimate point. Pure: no React, so Vitest covers it
 * (tests/ui/estimate-format.test.ts).
 */
import type { EstimateType, EstimateView } from "@/lib/tessera/types";

/** `time` minutes as `1h 30m`; categories and points as their stored text. */
export function formatEstimateValue(type: EstimateType, value: string): string {
  if (type !== "time") return value;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0) return value;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Selector options for one system: the point id and its formatted value. */
export function estimateOptions(estimate: EstimateView): { value: string; label: string }[] {
  return estimate.points.map((point) => ({ value: point.id, label: formatEstimateValue(estimate.type, point.value) }));
}
