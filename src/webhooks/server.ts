import express, { Express } from "express";
import cors from "cors";
import { handleCloverWebhook } from "./handlers/clover";
import adminRouter from "../routes/admin";
import productsRouter from "../routes/products";

export function createServer(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/webhooks/clover", handleCloverWebhook);
  app.use("/admin", adminRouter);
  app.use("/api/products", productsRouter);

  return app;
}
