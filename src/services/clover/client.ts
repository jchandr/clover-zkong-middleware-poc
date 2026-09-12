import axios from "axios";
import { config } from "../../config/env";

export interface CloverItem {
  id: string;
  name: string;
  price: number; // cents, integer
  priceType: "FIXED" | "VARIABLE" | "PER_UNIT";
  code?: string;
  sku?: string;
  stockCount?: number;
  itemStock?: { quantity: number };
  hidden?: boolean;
  available?: boolean;
  modifiedTime?: number;
}

function getToken(): string {
  if (!config.clover.apiToken) {
    throw new Error(
      "CLOVER_API_TOKEN is not set. Generate it: sandbox.dev.clover.com → Test Merchants → <merchant> → API Token, then set in .env"
    );
  }
  return config.clover.apiToken;
}

/**
 * Fetch full item data from Clover after webhook notification.
 * Clover sends only objectId like "I:8AW06CG1QDMHW", so we must GET /items/{id}.
 */
export async function getCloverItem(
  merchantId: string,
  itemId: string
): Promise<CloverItem> {
  const base = config.clover.apiBase.replace(/\/$/, "");
  const url = `${base}/${merchantId}/items/${itemId}?expand=itemStock`;

  const res = await axios.get<CloverItem>(url, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
    },
    timeout: 10_000,
  });

  return res.data;
}
