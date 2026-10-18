/**
 * Next calls `register` once when a server instance starts (decision 28).
 * The build phase and the edge runtime do not start the hourly automation timer.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("@/lib/tessera/automations/scheduler");
  startScheduler();
}
