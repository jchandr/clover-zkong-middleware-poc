import axios from "axios";
import * as crypto from "crypto";
import { IPosAdapter, NormalizedPosItem, PosWebhookEvent } from "./types";
import { CloverPosConfig } from "../db/models/integration";

export class CloverAdapter implements IPosAdapter {
  readonly posType = "clover";

  parseWebhook(
    reqBody: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>
  ): PosWebhookEvent {
    if (typeof reqBody?.verificationCode === "string") {
      return {
        eventType: "VERIFICATION",
        verificationCode: reqBody.verificationCode,
        rawPayload: reqBody,
      };
    }

    const authHeader = typeof headers["x-clover-auth"] === "string" 
      ? headers["x-clover-auth"] 
      : Array.isArray(headers["x-clover-auth"]) 
      ? headers["x-clover-auth"][0] 
      : undefined;

    const merchants = (reqBody?.merchants as Record<string, Array<{ objectId?: string; type?: string; ts?: number }>>) || {};
    for (const updates of Object.values(merchants)) {
      for (const u of updates) {
        const objectId = u.objectId || "";
        const type = (u.type || "").toUpperCase();

        if (objectId.startsWith("I:")) {
          const itemId = objectId.slice(2);
          const eventType = type === "DELETE" ? "DELETE" : type === "CREATE" ? "CREATE" : "UPDATE";
          return {
            eventType,
            objectId,
            itemId,
            authHeader,
            rawPayload: reqBody,
          };
        }
      }
    }

    return {
      eventType: "UNKNOWN",
      authHeader,
      rawPayload: reqBody,
    };
  }

  verifyAuth(
    headers: Record<string, string | string[] | undefined>,
    config: CloverPosConfig & Record<string, unknown>
  ): boolean {
    const expectedToken = config.cloverAuthToken;
    if (!expectedToken) {
      return false; // fail-closed if auth code not yet saved
    }

    const authHeaderVal = headers["x-clover-auth"];
    const receivedHeader = typeof authHeaderVal === "string" 
      ? authHeaderVal 
      : Array.isArray(authHeaderVal) 
      ? authHeaderVal[0] 
      : "";

    if (!receivedHeader) return false;

    const expected = Buffer.from(expectedToken, "utf8");
    const received = Buffer.from(receivedHeader, "utf8");

    if (expected.length !== received.length) {
      return false;
    }

    return crypto.timingSafeEqual(expected, received);
  }

  async getItem(
    itemId: string,
    config: CloverPosConfig & Record<string, unknown>
  ): Promise<NormalizedPosItem> {
    const apiBase = (config.apiBaseUrl || "https://sandbox.dev.clover.com/v3/merchants").replace(/\/$/, "");
    const merchantId = config.merchantId || "";
    const apiToken = config.apiToken || "";

    if (!merchantId || !apiToken) {
      throw new Error("Clover adapter: merchantId and apiToken are required");
    }

    // Try with expand=taxRates first, fall back if 403 (no permission)
    let item;
    try {
      const url = `${apiBase}/${merchantId}/items/${itemId}?expand=taxRates`;
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
        },
        timeout: 10000,
      });
      item = res.data;
    } catch (err: any) {
      if (err.response?.status === 403) {
        console.warn(`[clover-adapter] expand=taxRates forbidden, retrying without expand for ${itemId}`);
        const url = `${apiBase}/${merchantId}/items/${itemId}`;
        const res = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            Accept: "application/json",
          },
          timeout: 10000,
        });
        item = res.data;
      } else {
        throw err;
      }
    }

    const price = typeof item.price === "number" ? item.price : 0;

    // Calculate effective VAT rate if present
    let vatPercentage = 0;
    if (item.taxRates?.elements && Array.isArray(item.taxRates.elements)) {
      for (const tr of item.taxRates.elements) {
        if (typeof tr.rate === "number") {
          vatPercentage += tr.rate / 10000; // Clover stores 5% as 50000
        }
      }
    }

    const calculatedFinalPrice = Math.round(price * (1 + vatPercentage / 100));

    return {
      id: item.id,
      name: item.name || "",
      price,
      sku: item.sku || "",
      code: item.code || "",
      vatPercentage,
      calculatedFinalPrice,
      raw: item,
    };
  }

  async updateItemField(
    itemId: string,
    fieldName: string,
    value: unknown,
    config: CloverPosConfig & Record<string, unknown>
  ): Promise<boolean> {
    const apiBase = (config.apiBaseUrl || "https://sandbox.dev.clover.com/v3/merchants").replace(/\/$/, "");
    const merchantId = config.merchantId || "";
    const apiToken = config.apiToken || "";

    if (!merchantId || !apiToken) {
      throw new Error("Clover adapter: merchantId and apiToken are required");
    }

    const url = `${apiBase}/${merchantId}/items/${itemId}`;
    const payload: Record<string, unknown> = {};

    if (fieldName === "price" || fieldName === "calculated_final_price") {
      payload.price = Math.round(Number(value));
    } else {
      payload[fieldName] = value;
    }

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 10000,
    });

    return !!res.data;
  }

  getSchemaFields(): Array<{ key: string; label: string; type: "string" | "number" | "calculated" }> {
    return [
      { key: "price", label: "Raw Price (Cents)", type: "number" },
      { key: "calculated_final_price", label: "Calculated Final Price (with Tax/Rules)", type: "calculated" },
      { key: "name", label: "Product Name / Title", type: "string" },
      { key: "sku", label: "Product SKU", type: "string" },
      { key: "code", label: "Product Barcode / Code", type: "string" },
      { key: "vat_percentage", label: "VAT / Tax Rate Percentage", type: "number" },
    ];
  }
}
