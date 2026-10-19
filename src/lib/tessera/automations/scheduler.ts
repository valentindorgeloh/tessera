/**
 * Hourly automation timer (decision 28), maintenance job (decision 120) and
 * 10 s webhook dispatcher. Timers are unref'd so they do not keep a process
 * alive. `TESSERA_AUTOMATIONS=off` skips automations and maintenance;
 * `TESSERA_WEBHOOKS=off` skips webhook dispatch, independently.
 */
import { randomUUID } from "node:crypto";
import { acquireLease, LEASE_TTL_MS, releaseLease } from "./lease";

const MARK = Symbol.for("tessera.automationScheduler");
const FIRST_DELAY_MS = 60 * 1000;
const MAINTENANCE_FIRST_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WEBHOOK_INTERVAL_MS = 10_000;

type MarkedGlobal = typeof globalThis & { [MARK]?: true };

/** Starts the timers once per process. A dev reload that keeps `globalThis` does not start a second set. */
export function startScheduler(): void {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as MarkedGlobal;
  if (g[MARK]) return;
  g[MARK] = true;
  console.log("[tessera] scheduler started");

  if (process.env.TESSERA_AUTOMATIONS !== "off") {
    const first = setTimeout(() => {
      void runAutomationsOnce();
      const hourly = setInterval(() => void runAutomationsOnce(), HOUR_MS);
      hourly.unref();
    }, FIRST_DELAY_MS);
    first.unref();

    const maintenanceFirst = setTimeout(() => {
      void runMaintenanceOnce();
      const hourly = setInterval(() => void runMaintenanceOnce(), HOUR_MS);
      hourly.unref();
    }, MAINTENANCE_FIRST_MS);
    maintenanceFirst.unref();
  }

  if (process.env.TESSERA_WEBHOOKS !== "off") {
    const tick = setInterval(() => void runWebhooksOnce(), WEBHOOK_INTERVAL_MS);
    tick.unref();
  }
}

async function runAutomationsOnce(): Promise<void> {
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

async function runMaintenanceOnce(): Promise<void> {
  try {
    const { SYSTEM_ACTOR_ID } = await import("../actors");
    const { createContext } = await import("../core/context");
    const { getDb } = await import("../db/client");
    const { runMaintenance } = await import("../maintenance");
    const { db, sqlite } = getDb();
    runMaintenance(createContext({ db, sqlite, actorId: SYSTEM_ACTOR_ID }), {});
  } catch (err) {
    console.error("[tessera] maintenance run failed", err);
  }
}

async function runWebhooksOnce(): Promise<void> {
  try {
    const { SYSTEM_ACTOR_ID } = await import("../actors");
    const { createContext } = await import("../core/context");
    const { nowIso } = await import("../core/time");
    const { getDb } = await import("../db/client");
    const { enqueueDeliveries, sendDueDeliveries } = await import("../webhooks");
    const { db, sqlite } = getDb();
    const holder = `${process.pid}:${randomUUID()}`;
    const now = nowIso();
    if (!acquireLease(sqlite, "webhooks", holder, now, LEASE_TTL_MS)) return;
    try {
      const ctx = createContext({ db, sqlite, actorId: SYSTEM_ACTOR_ID });
      enqueueDeliveries(ctx, now);
      await sendDueDeliveries(ctx, now, fetch);
    } finally {
      releaseLease(sqlite, "webhooks", holder);
    }
  } catch (err) {
    console.error("[tessera] webhook dispatch failed", err);
  }
}
