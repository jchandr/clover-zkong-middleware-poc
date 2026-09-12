import express, { Express } from "express";
import { handleCloverWebhook } from "./handlers/clover";

export function createServer(): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/webhooks/clover", handleCloverWebhook);

  return app;
}
