/**
 * Hourly automation timer (decision 28). The first run is a minute after the
 * server is up, then every hour. Timers are unref'd so they do not keep a
 * process alive. `TESSERA_AUTOMATIONS=off` skips the timer. Webhook dispatch
 * is a separate lease and is not started here.
 */
const MARK = Symbol.for("tessera.automationScheduler");
const FIRST_DELAY_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type MarkedGlobal = typeof globalThis & { [MARK]?: true };

/** Starts the timer once per process. A dev reload that keeps `globalThis` does not start a second one. */
export function startScheduler(): void {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as MarkedGlobal;
  if (g[MARK]) return;
  g[MARK] = true;
  if (process.env.TESSERA_AUTOMATIONS === "off") return;
  const first = setTimeout(() => {
    void runOnce();
    const hourly = setInterval(() => void runOnce(), HOUR_MS);
    hourly.unref();
  }, FIRST_DELAY_MS);
  first.unref();
}

async function runOnce(): Promise<void> {
  try {
    const { SYSTEM_ACTOR_ID } = await import("../actors");
    const { createContext } = await import("../core/context");
    const { getDb } = await import("../db/client");
    const { runAutomations } = await import("./index");
    const { db, sqlite } = getDb();
    runAutomations(createContext({ db, sqlite, actorId: SYSTEM_ACTOR_ID }), {});
  } catch (err) {
    console.error("[tessera] automation run failed", err);
  }
}
