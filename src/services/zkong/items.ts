import { zkongClient } from "./client";
import { config } from "../../config/env";

export interface ZkongBatchImportPayload {
  merchantId: string;
  agencyId: string;
  storeId?: string;
  unitName?: number; // 0 = cents/100, 1 = decimal
  itemList: ZkongItem[];
}

export interface ZkongItem {
  barCode: string;
  itemTitle: string;
  price?: string;
  originalPrice?: string;
  attrCategory: string;
  attrName: string;
  productCode?: string;
  productSku?: string;
}

/**
 * Map Clover item (price in cents) → Zkong item format.
 * Zkong stores sale price as integer cents when unitName=0
 * (Zkong divides by 100 only for tag rendering). We send cents
 * string directly so Clover 3600 ($36.00) → Zkong "3600".
 * For POC: barCode = sku || code || cloverItem.id
 */
export function mapCloverToZkongItem(
  cloverItem: { id: string; name: string; price: number; sku?: string; code?: string }
): ZkongItem {
  const barCode = cloverItem.sku || cloverItem.code || cloverItem.id;
  return {
    barCode,
    itemTitle: cloverItem.name,
    price: String(cloverItem.price ?? 0),
    attrCategory: "default",
    attrName: "default",
    productCode: cloverItem.code || "",
    productSku: cloverItem.sku || "",
  };
}

export async function batchImportToZkong(
  items: ZkongItem[],
  opts?: { storeId?: string }
): Promise<void> {
  if (items.length === 0) return;

  const payload: ZkongBatchImportPayload = {
    merchantId: config.zkong.merchantId,
    agencyId: config.zkong.agencyId,
    storeId: opts?.storeId ?? "",
    unitName: 1, // keep cents verbatim; no implicit /100 (avoids 4200 → 42 round-trip)
    itemList: items,
  };

  const res = await zkongClient.post<{
    success: boolean;
    code: number;
    message: string;
    data: unknown;
  }>("/zk/item/batchImportItem", payload);

  if (!res.data.success) {
    throw new Error(
      `zkong batchImportItem failed: ${res.data.code} ${res.data.message} ${JSON.stringify(res.data.data)}`
    );
  }
  console.log(`[zkong] batchImportItem ok: ${items.length} items`);
}

export async function batchDeleteFromZkong(
  barCodes: string[],
  storeId?: string
): Promise<void> {
  if (barCodes.length === 0) return;

  // Per 3.2 spec: DELETE /zk/item/batchDeleteItem, body {storeId?, list: string[500]}
  // Empty storeId deletes from all stores under the merchant.
  const body: Record<string, unknown> = { list: barCodes };
  if (storeId) body.storeId = storeId;

  const res = await zkongClient.delete<{
    success: boolean;
    code: number;
    message: string;
  }>("/zk/item/batchDeleteItem", { data: body } as never);

  if (!res.data.success) {
    throw new Error(
      `zkong batchDeleteItem failed: ${res.data.code} ${res.data.message}`
    );
  }
  console.log(`[zkong] batchDeleteItem ok: ${barCodes.length} items`);
}
