// Standalone migration runner — `npm run migrate`.
import { validateEnv } from "./config.js";
validateEnv();

import { applySchema, waitForDb, pool } from "./db.js";

(async () => {
  try {
    await waitForDb();
    await applySchema();
    console.log("[migrate] schema applied");
  } catch (e) {
    console.error("[migrate] failed:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
