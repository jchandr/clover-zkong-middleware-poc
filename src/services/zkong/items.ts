import { zkongClient } from "./client";
import { config } from "../../config/env";
import { ZkongConfig } from "../../db/models/integration";

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
  attrCategory: string;
  attrName: string;
  productCode?: string;
  productSku?: string;
  [key: string]: unknown;
}

/**
 * Map Clover item (price in cents) → Zkong item format.
 * Zkong expects price as string BigDecimal; we send cents string via unitName=1
 * so Zkong uses raw values without dividing by 100.
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
    custFeature1: "",
    custFeature2: "",
    custFeature3: "",
    custFeature4: "",
    custFeature5: "",
  };
}

// Token cache for integration-specific Zkong configs
const tokenCache = new Map<string, { token: string; fetchedAt: number }>();

async function getZkongTokenForConfig(zkConfig: ZkongConfig): Promise<string> {
  const base = (zkConfig.apiBase || "https://esl-eu.zkong.com").replace(/\/$/, "");
  const account = zkConfig.account || "";
  const password = zkConfig.password || "";

  if (!account || !password) {
    throw new Error("Zkong account and password are required");
  }

  const cacheKey = `${account}@${base}`;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < 6 * 24 * 60 * 60 * 1000) {
    return cached.token;
  }

  // 1. Get RSA public key
  const keyRes = await zkongClient.get<{
    success: boolean;
    code: number;
    message: string;
    data: string;
  }>(`${base}/zk/user/getErpPublicKey`, { timeout: 10_000 });

  if (!keyRes.data.success || !keyRes.data.data) {
    throw new Error(`getErpPublicKey failed: ${keyRes.data.code} ${keyRes.data.message}`);
  }
  const publicKeyBase64 = keyRes.data.data.trim();

  // 2. Encrypt password
  const { encryptPassword } = await import("../../utils/rsa");
  const encryptedPassword = encryptPassword(publicKeyBase64, password);

  // 3. Login
  const loginRes = await zkongClient.post<{
    success: boolean;
    code: number;
    message: string;
    data: { token: string };
  }>(
    `${base}/zk/user/login`,
    {
      account: zkConfig.account,
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
  tokenCache.set(`${zkConfig.account}@${zkConfig.apiBase || "https://esl-eu.zkong.com"}`, { token, fetchedAt: now });
  return token;
}

// --- Integration-specific API functions (accept ZkongConfig) ---

export async function batchImportToZkongWithConfig(
  items: ZkongItem[],
  zkConfig: ZkongConfig,
  opts?: { storeId?: string }
): Promise<void> {
  if (items.length === 0) return;

  const payload = {
    merchantId: zkConfig.merchantId || "",
    agencyId: zkConfig.agencyId || "",
    storeId: opts?.storeId ?? "",
    unitName: 1, // 1 = raw values without Zkong dividing by 100
    itemList: items,
  };

  const res = await zkongClient.post<{
    success: boolean;
    code: number;
    message: string;
    data: unknown;
  }>("/zk/item/batchImportItem", payload, {
    headers: { Authorization: await getZkongTokenForConfig(zkConfig) },
    timeout: 15_000,
  });

  if (!res.data.success) {
    throw new Error(
      `zkong batchImportItem failed: ${res.data.code} ${res.data.message} ${JSON.stringify(res.data.data)}`
    );
  }
  console.log(`[zkong] batchImportItem ok: ${items.length} items`);
}

export async function batchDeleteFromZkongWithConfig(
  barCodes: string[],
  zkConfig: ZkongConfig,
  storeId?: string
): Promise<void> {
  if (barCodes.length === 0) return;

  const res = await zkongClient.post<{
    success: boolean;
    code: number;
    message: string;
  }>(
    "/zk/item/batchDeleteItem",
    {
      storeId: storeId ?? "",
      list: barCodes,
    },
    {
      headers: { Authorization: await getZkongTokenForConfig(zkConfig) },
      timeout: 15_000,
    }
  );

  if (!res.data.success) {
    throw new Error(
      `zkong batchDeleteItem failed: ${res.data.code} ${res.data.message}`
    );
  }
  console.log(`[zkong] batchDeleteItem ok: ${barCodes.length} items`);
}

// --- Backward-compatible wrapper functions using global config (for legacy webhook handler) ---
const globalZkConfig: ZkongConfig = {
  account: config.zkong.account,
  password: config.zkong.password,
  merchantId: config.zkong.merchantId,
  agencyId: config.zkong.agencyId,
  storeId: config.zkong.storeId,
  apiBase: config.zkong.apiBase,
};

export async function batchImportToZkong(
  items: ZkongItem[],
  opts?: { storeId?: string }
): Promise<void> {
  return batchImportToZkongWithConfig(items, globalZkConfig, opts);
}

export async function batchDeleteFromZkong(
  barCodes: string[],
  storeId?: string
): Promise<void> {
  return batchDeleteFromZkongWithConfig(barCodes, globalZkConfig, storeId);
}