import express, { Express } from "express";
import path from "path";
import fs from "fs";
import { handleCloverWebhook } from "./handlers/clover";
import { handleDynamicWebhook } from "./handlers/dynamic";
import { onboardingRouter } from "../api/onboarding";
import { integrationsManagementRouter } from "../api/integrations";

export function createServer(): Express {
  const app = express();

  app.use(express.json());

  // CORS for local development / web UI
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Clover-Auth");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Backward compatible static clover webhook
  app.post("/webhooks/clover", handleCloverWebhook);

  // Dynamic multi-tenant webhook endpoint: /webhooks/:integrationId
  app.all("/webhooks/:integrationId", handleDynamicWebhook);

  // Onboarding API routes
  app.use("/api/onboarding", onboardingRouter);

  // Integrations Management API routes
  app.use("/api/integrations", integrationsManagementRouter);

  // Serve static UI if built frontend dist exists
  const publicDir = path.join(__dirname, "../../public");
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.use((req, res, next) => {
      if (
        req.method === "GET" &&
        !req.path.startsWith("/api") &&
        !req.path.startsWith("/webhooks") &&
        !req.path.startsWith("/health")
      ) {
        res.sendFile(path.join(publicDir, "index.html"));
        return;
      }
      next();
    });
  }

  return app;
}
