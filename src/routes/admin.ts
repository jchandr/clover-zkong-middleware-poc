import { Router } from "express";
import { zkongClient } from "../services/zkong/client";
import { config } from "../config/env";
import { getPool } from "../db/connection";

// In-memory + DB-backed promo store for POC (Zkong does not return repricingList via list/get endpoints)
let memoryPromos: any[] = [];
const router = Router();

// POST /admin/promos — create a repricingList promo for a barCode
// Body: { barCode, promoPrice (cents as integer string e.g. "500"), startDate "YYYY-MM-DD", endDate "YYYY-MM-DD", startTime "HH:mm", endTime "HH:mm", storeId? }
router.post("/promos", async (req, res) => {
  const { barCode, promoPrice, startDate, endDate, startTime, endTime, storeId } = req.body ?? {};
  if (!barCode || !promoPrice || !startDate || !endDate || !startTime || !endTime) {
    return res.status(400).json({ error: "barCode, promoPrice, startDate, endDate, startTime, endTime are required" });
  }

  const sid = storeId || process.env.ZKONG_STORE_ID || "1787791370298";
  try {
    // Need itemTitle/attr for batchImport — fetch current to preserve
    const listRes: any = await zkongClient.post("/zk/erp/item/list?page=1&size=10", {
      storeId: Number(sid),
      attrCategory: "default",
      attrName: "default",
      pcBarCode: barCode,
    });
    let title = barCode;
    const found = (listRes.data?.data?.list ?? []).find((x: any) => x.barCode === barCode);
    if (found?.itemTitle) title = found.itemTitle;
    if (!found) {
      // fallback search all
      const all: any = await zkongClient.post("/zk/erp/item/list?page=1&size=50", { attrCategory: "default", attrName: "default" });
      const f2 = (all.data?.data?.list ?? []).find((x: any) => x.barCode === barCode);
      if (f2?.itemTitle) title = f2.itemTitle;
    }

    const payload = {
      merchantId: config.zkong.merchantId,
      agencyId: config.zkong.agencyId,
      storeId: sid,
      unitName: 1,
      repricingFullUpdate: 0,
      itemList: [
        {
          barCode,
          itemTitle: title,
          attrCategory: "default",
          attrName: "default",
          repricingList: [
            {
              repricingType: 1,
              auditTime: new Date().toISOString().slice(0, 19).replace("T", " "),
              repricingDateStart: startDate,
              repricingDateEnd: endDate,
              repricingTimeStart: startTime,
              repricingTimeEnd: endTime,
              price: String(promoPrice),
            },
          ],
        },
      ],
    };
    const r: any = await zkongClient.post("/zk/item/batchImportItem", payload);
    if (!r.data?.success) {
      return res.status(400).json({ error: `zkong failed: ${r.data?.code} ${r.data?.message}`, data: r.data?.data });
    }
    // Store locally for GET /admin/promos (Zkong list endpoints don't return repricingList)
    const entry = { barCode, promoPrice: String(promoPrice), startDate, endDate, startTime, endTime, storeId: sid, createdAt: new Date().toISOString() };
    memoryPromos.push(entry);
    // Also try to persist to DB if available
    try {
      await getPool().query(
        `CREATE TABLE IF NOT EXISTS promos (id SERIAL PRIMARY KEY, bar_code TEXT, promo_price TEXT, start_date TEXT, end_date TEXT, start_time TEXT, end_time TEXT, store_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`
      );
      await getPool().query(
        `INSERT INTO promos (bar_code, promo_price, start_date, end_date, start_time, end_time, store_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [barCode, String(promoPrice), startDate, endDate, startTime, endTime, sid]
      );
    } catch {}
    // Trigger immediate Zkong→Clover poll so pricing updates within seconds, not waiting for interval
    try {
      const { pollZkongOnce } = await import("../polling/zkong-poll");
      setTimeout(() => pollZkongOnce().catch(() => {}), 2000);
    } catch {}
    return res.json({ success: true, barCode, promoPrice, startDate, endDate, startTime, endTime, note: "Zkong price will update within ~30s (poller interval). Clover will follow on next poll." });
  } catch (e: any) {
    const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    return res.status(500).json({ error: msg });
  }
});

// GET /admin/promos — list promos created via this middleware (Zkong does not return repricingList via list APIs)
router.get("/promos", async (_req, res) => {
  try {
    // Try DB first
    try {
      const pool = getPool();
      await pool.query(`CREATE TABLE IF NOT EXISTS promos (id SERIAL PRIMARY KEY, bar_code TEXT, promo_price TEXT, start_date TEXT, end_date TEXT, start_time TEXT, end_time TEXT, store_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
      const r = await pool.query(`SELECT bar_code as "barCode", promo_price as "promoPrice", start_date as "startDate", end_date as "endDate", start_time as "startTime", end_time as "endTime", store_id as "storeId", created_at as "createdAt" FROM promos ORDER BY created_at DESC LIMIT 50`);
      if (r.rows.length > 0) return res.json({ promos: r.rows });
    } catch {}
    return res.json({ promos: memoryPromos });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
