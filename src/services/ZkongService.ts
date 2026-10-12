import axios from "axios";
import { encryptPassword } from "../utils/rsa";
import { ZkongConfig } from "../db/models/integration";

interface ApiEnvelope<T> {
  success: boolean;
  code: number;
  message: string;
  data: T;
}

interface LoginResponseData {
  token: string;
  currentUser?: {
    id: number;
    account: string;
    agencyId?: number;
    merchantId?: number;
  };
}

export interface ZkongStoreSchemaField {
  key: string;
  label: string;
  type: "string" | "number" | "date";
  description?: string;
}

export class ZkongService {
  private static tokenCache: Map<string, { token: string; fetchedAt: number }> = new Map();

  static async authenticate(zkConfig: ZkongConfig): Promise<string> {
    const base = (zkConfig.apiBase || "https://esl-eu.zkong.com").replace(/\/$/, "");
    const account = zkConfig.account || "";
    const password = zkConfig.password || "";

    if (!account || !password) {
      throw new Error("Zkong account and password are required");
    }

    const cacheKey = `${account}@${base}`;
    const cached = this.tokenCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 6 * 24 * 60 * 60 * 1000) {
      return cached.token;
    }

    // 1. Get RSA public key
    const keyRes = await axios.get<ApiEnvelope<string>>(
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
    const loginRes = await axios.post<ApiEnvelope<LoginResponseData>>(
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
    this.tokenCache.set(cacheKey, { token, fetchedAt: now });
    return token;
  }

  static async fetchSupportedFields(zkConfig: ZkongConfig): Promise<ZkongStoreSchemaField[]> {
    const token = await this.authenticate(zkConfig);
    const base = (zkConfig.apiBase || "https://esl-eu.zkong.com").replace(/\/$/, "");

    // Core fields supported by Zkong batch import and ERP lists
    const defaultFields: ZkongStoreSchemaField[] = [
      { key: "barCode", label: "Product Barcode / ID", type: "string", description: "Unique item identifier" },
      { key: "itemTitle", label: "Product Title / Name", type: "string" },
      { key: "price", label: "Selling Price (Tag Display)", type: "number", description: "Main display price" },
      { key: "originalPrice", label: "Original / Was Price", type: "number", description: "Reference strikethrough price" },
      { key: "memberPrice", label: "Member / VIP Price", type: "number" },
      { key: "custFeature1", label: "Extended Field 1 (Was / Promo Price)", type: "number" },
      { key: "custFeature2", label: "Extended Field 2 (Discount %)", type: "number" },
      { key: "custFeature3", label: "Extended Field 3 (Discount Number)", type: "number" },
      { key: "custFeature4", label: "Extended Field 4 (Promo Start Date)", type: "string" },
      { key: "custFeature5", label: "Extended Field 5 (Promo End Date)", type: "string" },
    ];

    try {
      // Also query store list or item list sample to verify connection works
      await axios.post(
        `${base}/zk/erp/item/list`,
        {},
        {
          headers: { Authorization: token },
          params: { page: 1, size: 1 },
          timeout: 10_000,
        }
      );
    } catch (err) {
      // Continue with default schema if sample fetch fails
      console.warn("[zkong] schema validation check warning:", (err as Error).message);
    }

    return defaultFields;
  }

  static async importItems(
    items: Array<Record<string, unknown>>,
    zkConfig: ZkongConfig
  ): Promise<void> {
    if (items.length === 0) return;

    const token = await this.authenticate(zkConfig);
    const base = (zkConfig.apiBase || "https://esl-eu.zkong.com").replace(/\/$/, "");

    const payload = {
      merchantId: zkConfig.merchantId || "",
      agencyId: zkConfig.agencyId || "",
      storeId: zkConfig.storeId || "",
      unitName: 1, // 1 = raw values without Zkong dividing by 100
      itemList: items,
    };

    const res = await axios.post<ApiEnvelope<unknown>>(
      `${base}/zk/item/batchImportItem`,
      payload,
      {
        headers: { Authorization: token, "Content-Type": "application/json" },
        timeout: 15_000,
      }
    );

    if (!res.data.success) {
      throw new Error(`Zkong batchImportItem failed: ${res.data.code} ${res.data.message}`);
    }
  }

  static async deleteItems(
    barCodes: string[],
    zkConfig: ZkongConfig
  ): Promise<void> {
    if (barCodes.length === 0) return;

    const token = await this.authenticate(zkConfig);
    const base = (zkConfig.apiBase || "https://esl-eu.zkong.com").replace(/\/$/, "");

    const res = await axios.post<ApiEnvelope<unknown>>(
      `${base}/zk/item/batchDeleteItem`,
      {
        storeId: zkConfig.storeId || "",
        list: barCodes,
      },
      {
        headers: { Authorization: token, "Content-Type": "application/json" },
        timeout: 15_000,
      }
    );

    if (!res.data.success) {
      throw new Error(`Zkong batchDeleteItem failed: ${res.data.code} ${res.data.message}`);
    }
  }
}
