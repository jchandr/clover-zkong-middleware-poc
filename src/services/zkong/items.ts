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
 * Zkong expects price as string BigDecimal; we send cents string via unitName=0
 * so Zkong divides by 100 internally, preserving exact Clover value.
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
    unitName: 0, // tell Zkong price is in cents (divided by 100)
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

  const res = await zkongClient.post<{
    success: boolean;
    code: number;
    message: string;
  }>("/zk/item/batchDeleteItem", {
    storeId: storeId ?? "",
    list: barCodes,
  });

  if (!res.data.success) {
    throw new Error(
      `zkong batchDeleteItem failed: ${res.data.code} ${res.data.message}`
    );
  }
  console.log(`[zkong] batchDeleteItem ok: ${barCodes.length} items`);
}
