import { config } from "./config/env";
import { createServer } from "./webhooks/server";
import { initDb } from "./db/connection";
import { getZkongToken } from "./services/zkong/auth";

async function main(): Promise<void> {
  // Init Postgres schema (creates tables on first run, retry until db is ready)
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await initDb();
      console.log("[db] Postgres ready");
      break;
    } catch (err) {
      if (attempt === 15) throw err;
      console.warn(`[db] not ready (attempt ${attempt}/15), retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Eagerly fetch Zkong token so auth issues surface at startup, not on first webhook
  if (config.zkong.account && config.zkong.password) {
    try {
      await getZkongToken();
      console.log("[zkong] token ready at startup");
    } catch (err) {
      console.warn(
        "[zkong] initial login failed (will retry on first API call):",
        (err as Error).message
      );
    }
  } else {
    console.warn("[zkong] ZKONG_ACCOUNT/PASSWORD not set, skipping login");
  }

  const app = createServer();

  app.listen(config.port, () => {
    console.log(`[middleware] listening on port ${config.port}`);
    console.log(
      `[middleware] webhook endpoint: POST http://localhost:${config.port}/webhooks/clover`
    );
  });
}

main().catch((err) => {
  console.error("[startup] failed:", err);
  process.exit(1);
});
