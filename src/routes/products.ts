import { Router } from "express";
import axios from "axios";
import { config } from "../config/env";
import { zkongClient } from "../services/zkong/client";

const router = Router();

function cloverHeaders() {
  if (!config.clover.apiToken) throw new Error("CLOVER_API_TOKEN not set");
  return { Authorization: `Bearer ${config.clover.apiToken}` };
}

// GET /api/products/matched — only products where sku and storeId match
// For POC: storeId must match, sku (Clover) == barCode (Zkong)
router.get("/matched", async (_req, res) => {
  try {
    const cloverBase = config.clover.apiBase.replace(/\/$/, "");
    const mId = config.clover.merchantId;
    const storeId = process.env.ZKONG_STORE_ID || "1787791370298";

    // Fetch Clover items (paginated, take first 100 for POC)
    const cloverRes = await axios.get(`${cloverBase}/${mId}/items?limit=100`, {
      headers: cloverHeaders(),
      timeout: 10000,
    });
    const cloverItems: any[] = cloverRes.data?.elements ?? cloverRes.data ?? [];
    // Normalize: { id, name, code, sku, price }
    const cloverBySku = new Map<string, any>();
    for (const it of cloverItems) {
      const sku = (it.sku || it.code || "").trim();
      if (sku) cloverBySku.set(sku, it);
    }

    // Fetch Zkong items for the store
    const zkongRes: any = await zkongClient.post("/zk/erp/item/list?page=1&size=100", {
      storeId: Number(storeId),
      attrCategory: "default",
      attrName: "default",
    });
    const zkongList: any[] = zkongRes.data?.data?.list ?? [];

    const matched: any[] = [];
    for (const z of zkongList) {
      const barCode = (z.barCode || "").trim();
      if (!barCode) continue;
      const c = cloverBySku.get(barCode);
      if (c) {
        matched.push({
          sku: barCode,
          storeId,
          clover: { id: c.id, name: c.name, price: c.price, sku: c.sku, code: c.code },
          zkong: { barCode: z.barCode, itemTitle: z.itemTitle, price: z.price, originalPrice: z.originalPrice, storeId: z.storeId },
        });
      }
    }

    return res.json({ storeId, matched, counts: { clover: cloverBySku.size, zkong: zkongList.length, matched: matched.length } });
  } catch (e: any) {
    const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    return res.status(500).json({ error: msg });
  }
});

// POST /api/products/sync — manually trigger Zkong → Clover poll immediately
router.post("/sync", async (_req, res) => {
  try {
    const { pollZkongOnce } = await import("../polling/zkong-poll");
    const n = await pollZkongOnce();
    return res.json({ success: true, pushed: n, message: `Synced ${n} price changes from Zkong to Clover` });
  } catch (e: any) {
    const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    return res.status(500).json({ error: msg });
  }
});

export default router;
