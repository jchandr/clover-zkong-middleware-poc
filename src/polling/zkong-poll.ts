import axios from "axios";
import { zkongClient } from "../services/zkong/client";
import { updateCloverItem } from "../services/clover/client";
import { batchImportToZkong } from "../services/zkong/items";
import { findByBarcode, upsertItemMap, ItemMapRow } from "../db/models/item-map";
import { ensureDefaultStore } from "../db/models/store";
import { logSync } from "../db/models/sync-log";
import { config } from "../config/env";
import { getPool } from "../db/connection";
import { IntegrationsRepo, IntegrationRow, IntegrationStatus, ZkongConfig } from "../db/models/integration";
import { encryptPassword } from "../utils/rsa";

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

// Per-integration poller: polls Zkong for a specific LIVE integration
// Per-integration Zkong token cache
const integrationTokenCache = new Map<
  string,
  { token: string; fetchedAt: number }
>();

async function getIntegrationZkongToken(
  zkConfig: ZkongConfig
): Promise<string> {
  const cacheKey = `${zkConfig.account}@${zkConfig.apiBase || "https://esl-eu.zkong.com"}`;
  const cached = integrationTokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < 6 * 24 * 60 * 60 * 1000) {
    return cached.token;
  }

  const base = (zkConfig.apiBase || "https://esl-eu.zkong.com").replace(/\/$/, "");
  const account = zkConfig.account || "";
  const password = zkConfig.password || "";

  if (!account || !password) {
    throw new Error("Zkong account and password are required");
  }

  // 1. Get RSA public key
  const keyRes = await axios.get<{ success: boolean; code: number; message: string; data: string }>(
    `${base}/zk/user/getErpPublicKey`,
    { timeout: 10_000 }
  );
  if (!keyRes.data.success || !keyRes.data.data) {
    throw new Error(`getErpPublicKey failed: ${keyRes.data.code} ${keyRes.data.message}`);
  }
  const publicKeyBase64 = keyRes.data.data.trim();

  // 2. Encrypt password
  const encryptedPassword = encryptPassword(publicKeyBase64, password);

  // 3. Login
  const loginRes = await axios.post<{
    success: boolean;
    code: number;
    message: string;
    data: { token: string };
  }>(
    `${base}/zk/user/login`,
    {
      account,
      password: encryptedPassword,
      loginType: 3,
    },
    {
      timeout: 10_000,
      headers: { "Content-Type": "application/json;charset=utf-8" },
    }
  );

  if (!loginRes.data.success || !loginRes.data.data?.token) {
    throw new Error(`Zkong login failed: ${loginRes.data.code} ${loginRes.data.message}`);
  }

  const token = loginRes.data.data.token;
  integrationTokenCache.set(cacheKey, { token, fetchedAt: now });
  return token;
}

export async function pollIntegrationOnce(
  integration: IntegrationRow
): Promise<{ fetched: number; pushed: number }> {
  console.log(
    `[poller] Polling Zkong for integration ${integration.integration_id} (${integration.registering_business_name})`
  );

  const zkConfig = integration.zkong_configuration as ZkongConfig;
  if (!zkConfig.account || !zkConfig.password || !zkConfig.merchantId) {
    console.warn(
      `[poller] Integration ${integration.integration_id} missing Zkong credentials, skipping`
    );
    return { fetched: 0, pushed: 0 };
  }

  // Get or create default store for this integration
  const store = await ensureDefaultStore(
    "",
    (integration.pos_configuration as { merchantId?: string }).merchantId || ""
  );

  let pageNum = 1;
  const pageSize = 200;
  let totalPages = 1;
  let fetchedCount = 0;
  let pushedCount = 0;

  do {
    const res = await axios.post<{
      success: boolean;
      code: number;
      message: string;
      data: ZkongItemListResponse;
    }>(
      `${zkConfig.apiBase || "https://esl-eu.zkong.com"}/zk/erp/item/list`,
      {},
      {
        params: { page: pageNum, size: pageSize },
        headers: { Authorization: await getIntegrationZkongToken(integration.zkong_configuration) },
        timeout: 15000,
      }
    );

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
        // Update Clover price using integration's POS config
        const posConfig = integration.pos_configuration;
        const cloverMerchantId = (integration.pos_configuration as { merchantId?: string }).merchantId;
        if (!cloverMerchantId) {
          console.warn(
            `[poller] Integration ${integration.integration_id} missing Clover merchantId, skipping Clover update`
          );
        } else {
          await updateCloverItem(cloverMerchantId, existing.clover_item_id, {
            price: saleCents,
          });
        }

        // Update Zkong main price (售价) field on tag
        await batchImportToZkong(
          [
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
          ],
          { storeId: (integration.zkong_configuration as ZkongConfig).storeId }
        );

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

  console.log(
    `[poller] Poll finished for ${integration.integration_id}. Fetched ${fetchedCount} items, updated ${pushedCount} in Clover.`
  );
  return { fetched: fetchedCount, pushed: pushedCount };
}

export async function pollZkongOnce(): Promise<{ fetched: number; pushed: number }> {
  console.log("[poller] Polling Zkong items for all LIVE integrations...");

  const liveIntegrations = await IntegrationsRepo.findAll({
    status: IntegrationStatus.LIVE,
    includeDeleted: false,
  });

  if (liveIntegrations.list.length === 0) {
    console.log("[poller] No LIVE integrations found, skipping poll");
    return { fetched: 0, pushed: 0 };
  }

  let totalFetched = 0;
  let totalPushed = 0;

  for (const integration of liveIntegrations.list) {
    try {
      const result = await pollIntegrationOnce(integration);
      totalFetched += result.fetched;
      totalPushed += result.pushed;
    } catch (err) {
      console.error(
        `[poller] Error polling integration ${integration.integration_id}:`,
        (err as Error).message
      );
    }
  }

  console.log(
    `[poller] Poll finished for ${liveIntegrations.list.length} LIVE integrations. Fetched ${totalFetched} items, updated ${totalPushed} in Clover.`
  );
  return { fetched: totalFetched, pushed: totalPushed };
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
