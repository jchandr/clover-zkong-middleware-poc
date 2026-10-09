import { zkongClient } from "../services/zkong/client";
import { updateCloverItem } from "../services/clover/client";
import { batchImportToZkong } from "../services/zkong/items";
import { findByBarcode, upsertItemMap, ItemMapRow } from "../db/models/item-map";
import { ensureDefaultStore } from "../db/models/store";
import { logSync } from "../db/models/sync-log";
import { config } from "../config/env";
import { getPool } from "../db/connection";

export interface ZkongApiItem {
  id?: number | string;
  barCode: string;
  itemTitle?: string;
  price?: string | number;
  originalPrice?: string | number;
  [key: string]: unknown;
}

export interface ZkongItemListResponse {
  list: ZkongApiItem[];
  totalElements?: number;
}

export function zkongPriceToCents(priceStr: string | number | undefined | null): number {
  if (priceStr === undefined || priceStr === null) return 0;
  const str = String(priceStr).trim();
  if (!str) return 0;
  const num = parseFloat(str);
  if (isNaN(num)) return 0;
  // Both Clover API and Zkong store raw cents (e.g. 870000 = $8700.00)
  return Math.round(num);
}

export async function pollZkongOnce(): Promise<{ fetched: number; pushed: number }> {
  console.log("[poller] Polling Zkong items...");

  const store = await ensureDefaultStore("", config.clover.merchantId);
  let pageNum = 1;
  const pageSize = 200;
  let totalPages = 1;
  let fetchedCount = 0;
  let pushedCount = 0;

  do {
    // Per API 3.8: page/size are QUERY params; body takes only optional
    // filters (storeId, attrClass, attrName, pcItemTitle, pcBarCode, ...).
    // merchantId/agencyId are NOT valid params here (causes 11111).
    // Omitting storeId returns merchant-level products.
    const res = await zkongClient.post<{
      success: boolean;
      code: number;
      message: string;
      data: ZkongItemListResponse;
    }>("/zk/erp/item/list", {}, { params: { page: pageNum, size: pageSize } });

    if (!res.data.success || !res.data.data) {
      console.error(
        `[poller] Zkong item list poll failed on page ${pageNum}: ${res.data.code} ${res.data.message}`
      );
      break;
    }

    const { list = [], totalElements = 0 } = res.data.data;
    totalPages = Math.max(1, Math.ceil(totalElements / pageSize));
    fetchedCount += list.length;

    for (const item of list) {
      if (!item.barCode) continue;

      // Zkong stores the discount in extended (custFeature) fields, not in
      // price/originalPrice. Per dashboard layout:
      //   custFeature1 = Was, custFeature2 = Discount %, custFeature3 = Discount Number
      // Sale price = Was * (1 - Discount%/100), or Discount Number directly.
      const priceCents = zkongPriceToCents(item.price);
      const wasCents = zkongPriceToCents(
        item.custFeature1 as string | number | null | undefined
      );
      const discountPct = parseFloat(String(item.custFeature2 ?? "")) || 0;
      const discountNumberCents = zkongPriceToCents(
        item.custFeature3 as string | number | null | undefined
      );

      const existing = await findByBarcode(store.id, item.barCode);

      if (!existing) {
        continue;
      }

      const baseForDiscount =
        wasCents > 0
          ? wasCents
          : existing.promo_active
          ? existing.standard_price
          : priceCents;

      let saleCents: number;
      let promoActive: boolean;
      let standardPriceToSave: number;

      if (discountPct > 0) {
        saleCents = Math.round(baseForDiscount * (1 - discountPct / 100));
        promoActive = true;
        standardPriceToSave = baseForDiscount;
      } else if (discountNumberCents > 0) {
        saleCents = discountNumberCents;
        promoActive = true;
        standardPriceToSave = baseForDiscount;
      } else {
        promoActive = false;
        standardPriceToSave = existing.promo_active ? existing.standard_price : priceCents;
        saleCents = standardPriceToSave;
      }

      // Skip only if sale price AND promo state AND Zkong price all match target
      if (
        saleCents === existing.last_pushed_price &&
        promoActive === existing.promo_active &&
        priceCents === saleCents
      ) {
        continue;
      }

      console.log(
        `[poller] Zkong change for ${item.barCode}: sale=${saleCents} base=${standardPriceToSave} was=${wasCents} discount=${discountPct}% promo=${promoActive} (was promo=${existing.promo_active})`
      );

      try {
        // Update Clover price
        await updateCloverItem(config.clover.merchantId, existing.clover_item_id, {
          price: saleCents,
        });

        // Update Zkong main price (售价) field on tag
        await batchImportToZkong([
          {
            barCode: item.barCode,
            itemTitle: String(item.itemTitle || item.barCode),
            price: String(saleCents),
            attrCategory: String(item.attrCategory || "default"),
            attrName: String(item.attrName || "default"),
            productCode: String(item.productCode || ""),
            productSku: String(item.productSku || ""),
            custFeature1: item.custFeature1,
            custFeature2: item.custFeature2,
            custFeature3: item.custFeature3,
            custFeature4: item.custFeature4,
            custFeature5: item.custFeature5,
          },
        ]);

        await upsertItemMap({
          store_id: store.id,
          clover_item_id: existing.clover_item_id,
          zkong_barcode: item.barCode,
          standard_price: standardPriceToSave,
          last_pushed_price: saleCents,
          promo_active: promoActive,
          zkong_item_id: item.id ? Number(item.id) : null,
          last_zkong_update_time: new Date().toISOString(),
        });

        await logSync({
          item_map_id: existing.id,
          direction: "zkong->clover",
          action: promoActive ? "APPLY_PROMO_PRICE" : "CLEAR_PROMO_PRICE",
          from_price: existing.standard_price,
          to_price: saleCents,
          reason: promoActive
            ? `Zkong promo for ${item.barCode}: was=${wasCents} discount=${discountPct}% -> sale=${saleCents}`
            : `Zkong promo ended for ${item.barCode}, restored base=${standardPriceToSave}`,
        });

        pushedCount++;
      } catch (err) {
        console.error(
          `[poller] Failed updating Clover item ${existing.clover_item_id}:`,
          (err as Error).message
        );
        await logSync({
          item_map_id: existing.id,
          direction: "zkong->clover",
          action: "UPDATE_PRICE_FAILED",
          from_price: existing.standard_price,
          to_price: saleCents,
          reason: (err as Error).message,
          success: false,
        });
      }
    }

    pageNum++;
  } while (pageNum <= totalPages);

  console.log(`[poller] Poll finished. Fetched ${fetchedCount} items, updated ${pushedCount} in Clover.`);
  return { fetched: fetchedCount, pushed: pushedCount };
}

export interface ZkongStrategy {
  id: number;
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: number;
  selectedFieldNames?: string[];
}

interface ZkongStrategyListResponse {
  list: ZkongStrategy[];
  totalElements?: number;
}

let lastStrategySummary = "";

/**
 * Visibility poll for active Zkong promo strategies (8.3 strategy/list).
 * Does not drive price changes -- the item/list poll already mirrors Zkong's
 * `price` (which Zkong's scheduler flips for promo start/end). This only
 * logs what promos are live so we can see windows/status in middleware logs.
 */
export async function pollZkongStrategies(): Promise<void> {
  if (!config.zkong.storeId) {
    return; // ZKONG_STORE_ID not configured; visibility poll disabled
  }

  const res = await zkongClient.post<{
    success: boolean;
    code: number;
    message: string;
    data: ZkongStrategyListResponse | null;
  }>(
    `/zk/strategy/list/1/50?isValid=true`,
    { storeId: config.zkong.storeId },
    { timeout: 15000 }
  );

  if (!res.data.success || !res.data.data) {
    console.error(
      `[poller] strategy/list failed: ${res.data.code} ${res.data.message}`
    );
    return;
  }

  const { list = [], totalElements = 0 } = res.data.data;
  const summary = list
    .map(
      (s) =>
        `#${s.id} "${s.name ?? ""}" [${s.startDate ?? "?"} -> ${
          s.endDate ?? "?"
        }] status=${s.status ?? "?"}`
    )
    .join(" | ");

  if (summary !== lastStrategySummary) {
    lastStrategySummary = summary;
    console.log(
      `[poller] active Zkong strategies (${totalElements}): ${
        summary || "none"
      }`
    );
  }
}

/**
 * One-time debug dump: shows raw Zkong API price/originalPrice for every
 * mapped item next to what we last pushed. Run after first poll at startup.
 */
export async function debugMappedZkongItems(): Promise<void> {
  try {
    const store = await ensureDefaultStore("", config.clover.merchantId);
    const mapped = await getPool().query<ItemMapRow>("SELECT * FROM item_map");
    if (mapped.rows.length === 0) {
      console.log("[debug] no mapped items");
      return;
    }
    const res = await zkongClient.post<{
      success: boolean;
      data: ZkongItemListResponse;
    }>("/zk/erp/item/list", {}, { params: { page: 1, size: 200 } });
    const list = res.data.data?.list ?? [];
    for (const row of mapped.rows) {
      const item = list.find((i) => i.barCode === row.zkong_barcode);
      const features: string[] = [];
      if (item) {
        for (let i = 1; i <= 50; i++) {
          const v = (item as Record<string, unknown>)[`custFeature${i}`];
          if (v !== undefined && v !== null && v !== "") {
            features.push(`custFeature${i}=${String(v)}`);
          }
        }
      }
      console.log(
        `[debug] ${row.zkong_barcode}: api price=${item?.price ?? "NOT FOUND"} originalPrice=${item?.originalPrice ?? "NOT FOUND"} | db last_pushed=${row.last_pushed_price} promo_active=${row.promo_active}`
      );
      if (features.length > 0) {
        console.log(`[debug] ${row.zkong_barcode} extended fields: ${features.join(", ")}`);
      }
    }
  } catch (err) {
    console.error("[debug] failed:", (err as Error).message);
  }
}

let pollTimer: NodeJS.Timeout | null = null;
let lastStrategyPollAt = 0;
let debuggedOnce = false;
const STRATEGY_POLL_MIN_INTERVAL_MS = 60000;

export function startZkongPoller(intervalMs: number = 60000): void {
  if (pollTimer) return;
  console.log(`[poller] Starting Zkong -> Clover poller (interval: ${intervalMs}ms)`);

  const run = async () => {
    try {
      await pollZkongOnce();
    } catch (err) {
      console.error("[poller] Poll execution error:", (err as Error).message);
    }

    if (!debuggedOnce) {
      debuggedOnce = true;
      await debugMappedZkongItems();
    }

    // Promo strategy visibility (rate-limited to once/minute regardless of
    // item poll cadence)
    const now = Date.now();
    if (config.zkong.storeId && now - lastStrategyPollAt >= STRATEGY_POLL_MIN_INTERVAL_MS) {
      lastStrategyPollAt = now;
      try {
        await pollZkongStrategies();
      } catch (err) {
        console.error(
          "[poller] Strategy poll error:",
          (err as Error).message
        );
      }
    }
  };

  void run();
  pollTimer = setInterval(run, intervalMs);
}
