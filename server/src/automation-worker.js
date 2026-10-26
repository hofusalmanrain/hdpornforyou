// HDPORNFORYOU — dedicated automation worker process.
//
// Owns the ENTIRE automation engine: every engine timer, import cycle, AI
// budget decision and thumbnail scan lives in this single process, so admin
// settings (intervalMinutes, aiBatchSize, aiDailyLimit, dailyImportLimit…)
// are honored exactly instead of N cluster workers racing on the Postgres
// advisory lock.
//
// - API cluster workers relay admin actions (Start/Stop/Manual/…) through
//   the automation_commands table; this process polls and executes them.
// - The Postgres advisory lock (automation.js withRunLock) stays in place as
//   a fail-safe so a duplicated/restarting process can never double-import.
// - PM2 restarts this process on crash; the engine watchdog re-arms the
//   schedule from DB state, so import resumes automatically.
//
// Run via PM2 (ecosystem.config.cjs "hdpornforyou-automation"), Docker
// Compose ("automation" service), or manually:
//   cd server && RUN_AUTOMATION=1 npm run start:worker

import { validateEnv } from "./config.js";
validateEnv();

import { waitForDb, applySchema, pool } from "./db.js";
import { initAutomation, runAutomationCommandConsumer } from "./automation.js";
import { startRetentionCleanup } from "./retention.js";

await waitForDb();
await applySchema();
startRetentionCleanup();

await initAutomation().catch((e) => console.error("[automation-worker] init error:", e));
runAutomationCommandConsumer();

console.log("[automation-worker] running — dedicated automation engine (RUN_AUTOMATION=1)");

async function shutdown(signal) {
  console.log(`[automation-worker] ${signal} received — closing DB pool…`);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (e) => console.error("[automation-worker] uncaughtException", e));
process.on("unhandledRejection", (e) => console.error("[automation-worker] unhandledRejection", e));
