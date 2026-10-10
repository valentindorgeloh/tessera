/**
 * Pins the process time zone for one synchronous block. Node re-reads
 * `process.env.TZ` at runtime, so `Date` and the engine's local-day helpers
 * (core/time.ts) follow it immediately; the previous value is restored even
 * when `fn` throws so other test files keep the machine's zone.
 */
export function withTimeZone<T>(zone: string, fn: () => T): T {
  const saved = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
}
