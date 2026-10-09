import { Request, Response } from "express";
import * as crypto from "crypto";
import { config } from "../../config/env";

/**
 * Handler for incoming Clover webhooks.
 *
 * Clover's webhook verification (confirmed from docs.clover.com/docs/webhooks)
 * is a two-phase, static-shared-value scheme -- NOT a per-request HMAC
 * signature of the payload:
 *
 * 1. One-time callback URL verification: when you first configure the
 *    webhook URL in the Developer Dashboard, Clover POSTs a body containing
 *    `verificationCode`. You copy that value and paste it into the
 *    Dashboard's "Verification Code" field to complete setup. This handler
 *    logs that code so it can be copied out, but does not need to act on it
 *    beyond that (no ongoing significance once verification is done).
 *
 * 2. Every subsequent real webhook includes a static header:
 *      X-Clover-Auth: <Clover Auth Code>
 *    where <Clover Auth Code> is the fixed value shown under
 *    Your Apps > App Settings > Webhooks in the Developer Dashboard.
 *    We verify every request by comparing this header (constant-time) against
 *    CLOVER_AUTH_CODE from env. This is a shared static value, not a rotating
 *    signature -- if it's ever exposed (e.g. via logs), it must be rotated
 *    in the Dashboard and CLOVER_AUTH_CODE updated to match.
 *
 * SYNC TODO:
 * - Parse Clover's webhook envelope (merchants[mId].{items,inventory,...})
 *   and route item/inventory events to the sync engine (not built yet).
 */

function isAuthorized(req: Request): boolean {
  if (!config.cloverAuthCode) {
    // Fails closed: if we haven't configured the expected value yet, treat
    // every request as unauthorized rather than silently accepting anything.
    return false;
  }

  const receivedHeader = req.header("X-Clover-Auth") ?? "";

  const expected = Buffer.from(config.cloverAuthCode, "utf8");
  const received = Buffer.from(receivedHeader, "utf8");

  // timingSafeEqual requires equal-length buffers; unequal length alone
  // means "not authorized" without needing the timing-safe comparison.
  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, received);
}

export function handleCloverWebhook(req: Request, res: Response): void {
  const body = req.body ?? {};

  if (typeof body.verificationCode === "string") {
    console.log(
      `[clover webhook] received verificationCode: ${body.verificationCode}`
    );
    console.log(
      "[clover webhook] paste this into the Developer Dashboard's Verification Code field to complete setup."
    );
    res.status(200).json({ received: true });
    return;
  }

  if (!isAuthorized(req)) {
    console.warn(
      "[clover webhook] rejected request: missing/invalid X-Clover-Auth header"
    );
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  console.log("[clover webhook] received payload:", JSON.stringify(body));

  // Ack immediately so Clover doesn't retry, then process async.
  res.status(200).json({ received: true });

  // Fire-and-forget: fetch full item data and push to Zkong.
  // Errors are logged but do not affect the 200 already sent to Clover.
  void processCloverWebhookAsync(body).catch((err) => {
    console.error("[clover webhook] async processing failed:", err);
  });
}

interface CloverWebhookBody {
  appId?: string;
  merchants?: Record<string, Array<{ objectId: string; type: string; ts: number }>>;
}

async function processCloverWebhookAsync(body: CloverWebhookBody): Promise<void> {
  const { getCloverItem } = await import("../../services/clover/client");
  const { batchImportToZkong, batchDeleteFromZkong, mapCloverToZkongItem } =
    await import("../../services/zkong/items");

  const merchants = body.merchants ?? {};
  for (const [merchantId, updates] of Object.entries(merchants)) {
    for (const u of updates) {
      const objectId: string = u.objectId ?? "";
      const type: string = u.type ?? "";

      // Only handle Inventory items (I:<id>), ignore other types (O:, P:, etc.)
      if (!objectId.startsWith("I:")) {
        console.log(`[sync] skipping non-inventory objectId=${objectId}`);
        continue;
      }

      const itemId = objectId.slice(2);

      if (type === "DELETE") {
        console.log(`[sync] Clover DELETE ${merchantId} ${itemId} -> Zkong`);
        try {
          // For DELETE we don't have item data, so delete by any barCode that matches this Clover id.
          // For POC: try id as barCode, and sku/code variants will be covered by item_map lookup once implemented.
          await batchDeleteFromZkong([itemId]);
        } catch (e) {
          console.error(`[sync] Zkong delete failed for ${itemId}:`, (e as Error).message);
        }
        continue;
      }

      // CREATE or UPDATE: fetch full item, then upsert to Zkong
      if (type === "CREATE" || type === "UPDATE") {
        try {
          console.log(`[sync] fetching Clover item ${merchantId}/${itemId}`);
          const item = await getCloverItem(merchantId, itemId);
          console.log(`[sync] fetched: ${item.name} price=${item.price} sku=${item.sku ?? ""} code=${item.code ?? ""}`);
          const zkongItem = mapCloverToZkongItem(item);

          const { ensureDefaultStore } = await import("../../db/models/store");
          const { upsertItemMap, findByCloverId } = await import("../../db/models/item-map");
          const { logSync } = await import("../../db/models/sync-log");

          const store = await ensureDefaultStore("", merchantId);
          const existing = await findByCloverId(store.id, item.id);

          // Preserve existing barcode if item was already mapped, preventing duplicates in Zkong
          if (existing) {
            zkongItem.barCode = existing.zkong_barcode;
          }

          // Echo suppression: if price matches what we last pushed, ignore to prevent loop
          if (existing && existing.last_pushed_price === item.price) {
            console.log(`[sync] echo suppressed for Clover item ${item.id} (price ${item.price} matches last_pushed_price)`);
            continue;
          }

          console.log(`[sync] pushing to Zkong barCode=${zkongItem.barCode} price=${item.price} (clearing any active Zkong discount)`);
          await batchImportToZkong([zkongItem]);

          const mappedRow = await upsertItemMap({
            store_id: store.id,
            clover_item_id: item.id,
            zkong_barcode: zkongItem.barCode,
            standard_price: item.price,
            last_pushed_price: item.price,
            promo_active: false,
            zkong_item_id: existing?.zkong_item_id ?? null,
            last_zkong_update_time: new Date().toISOString(),
          });

          await logSync({
            item_map_id: mappedRow.id,
            direction: "clover->zkong",
            action: type,
            from_price: null,
            to_price: item.price,
            reason: `Clover ${type} ${itemId}`,
          });
        } catch (e) {
          const msg = (e as Error).message;
          // 404 means item was deleted between webhook and fetch — treat as delete
          if (msg.includes("404") || msg.includes("Not Found")) {
            console.warn(`[sync] item ${itemId} not found (likely deleted), skipping`);
          } else {
            console.error(`[sync] failed for ${itemId}:`, msg);
          }
        }
      }
    }
  }
}
