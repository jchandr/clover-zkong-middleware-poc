import { zkongClient } from "../services/zkong/client";
import { updateCloverItem } from "../services/clover/client";
import { ensureDefaultStore } from "../db/models/store";
import { findByBarcode, upsertItemMap } from "../db/models/item-map";
import { logSync } from "../db/models/sync-log";
import { config } from "../config/env";

interface ZkongListItem {
  id: number | string;
  barCode: string;
  price?: string | number | null;
  updateTime?: string;
  itemTitle?: string;
}

function zkongPriceToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (s === "") return null;
  // Zkong sale price is cent-based (both dashboard and API keep cents string,
  // e.g. "4400" = $44.00). With unitName:1 we store cents verbatim,
  // so no *100 here — just parse the integer cents. If Zkong ever returns
  // a decimal dollars string like "42.00", treat it as cents after stripping.
  if (s.includes(".")) {
    // Defensive: if Zkong returns dollars like "42.00", convert to cents
    const f = parseFloat(s);
    if (isNaN(f)) return null;
    // Heuristic: values < 1000 with a decimal are likely dollars
    // e.g. "42.00" → 4200, while "4200" stays 4200
    return Math.round(f * 100);
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

export async function pollZkongOnce(): Promise<number> {
  const poolStoreMerchantId = config.clover.merchantId; // single Clover merchant for POC
  // For POC we poll merchant-level items (storeId not set). Once store-scoped, pass storeId.
  let page = 1;
  const size = 50;
  let pushed = 0;

  // Ensure the synthetic default store exists before polling
  const storeId = await ensureDefaultStore(poolStoreMerchantId);

  while (true) {
    const res = await zkongClient.post<{
      success: boolean;
      code: number;
      message: string;
      data: { list: ZkongListItem[]; totalElements?: number };
    }>(`/zk/erp/item/list?page=${page}&size=${size}`, {
      attrCategory: "default",
      attrName: "default",
    });

    if (!res.data.success) {
      throw new Error(`zkong erp/item/list failed: ${res.data.code} ${res.data.message}`);
    }

    const list = res.data.data?.list ?? [];
    if (list.length === 0) break;

    for (const zi of list) {
      const barCode = zi.barCode;
      if (!barCode) continue;

      const cents = zkongPriceToCents(zi.price);
      if (cents === null) continue;

      const mapped = await findByBarcode(storeId, barCode);
      if (!mapped) {
        // Item exists in Zkong but not yet mapped from Clover — skip creation for POC.
        // Future: could create in Clover here.
        continue;
      }

      // Skip if we've already seen this updateTime
      if (zi.updateTime && mapped.last_zkong_update_time === zi.updateTime) continue;
      // Also skip if price hasn't actually changed from what we last pushed
      if (cents === mapped.last_pushed_price) {
        // Still update last_zkong_update_time to avoid re-checking next poll
        if (zi.updateTime) {
          await upsertItemMap({ ...mapped, store_id: storeId, last_zkong_update_time: zi.updateTime });
        }
        continue;
      }

      console.log(`[zkong poll] ${barCode} Zkong price ${cents} != Clover last_pushed ${mapped.last_pushed_price}, pushing to Clover ${mapped.clover_item_id}`);
      try {
        await updateCloverItem(poolStoreMerchantId, mapped.clover_item_id, { price: cents });
        await upsertItemMap({
          store_id: storeId,
          clover_item_id: mapped.clover_item_id,
          zkong_barcode: barCode,
          standard_price: mapped.promo_active ? mapped.standard_price : cents,
          last_pushed_price: cents,
          active_promo_id: mapped.active_promo_id,
          active_promo_price: mapped.active_promo_price,
          promo_active: Boolean(mapped.promo_active),
          zkong_item_id: Number(zi.id) || mapped.zkong_item_id,
          last_zkong_update_time: zi.updateTime ?? mapped.last_zkong_update_time,
        });
        await logSync({ item_map_id: mapped.id, direction: "zkong->clover", action: "UPDATE", from_price: mapped.last_pushed_price, to_price: cents, reason: `Zkong ${barCode} price change` });
        pushed++;
      } catch (e) {
        console.error(`[zkong poll] failed to push ${barCode} to Clover:`, (e as Error).message);
        await logSync({ item_map_id: mapped.id, direction: "zkong->clover", action: "UPDATE_FAILED", from_price: mapped.last_pushed_price, to_price: cents, reason: (e as Error).message, success: false });
      }
    }

    if (list.length < size) break;
    page++;
  }

  if (pushed > 0) console.log(`[zkong poll] pushed ${pushed} price changes to Clover`);
  return pushed;
}

export function startZkongPoller(): NodeJS.Timeout {
  const intervalMs = parseInt(process.env.ZKONG_POLL_INTERVAL_MS ?? "300000", 10); // default 5min
  console.log(`[zkong poll] starting interval ${intervalMs}ms`);

  // Run once shortly after startup, then on interval
  setTimeout(() => {
    pollZkongOnce().catch((e) => console.error("[zkong poll] initial run failed:", e));
  }, 10_000);

  return setInterval(() => {
    pollZkongOnce().catch((e) => console.error("[zkong poll] failed:", e));
  }, intervalMs);
}
