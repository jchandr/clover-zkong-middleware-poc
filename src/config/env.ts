import * as dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),

  clover: {
    apiBase: requireEnv(
      "CLOVER_API_BASE",
      "https://sandbox.dev.clover.com/v3/merchants"
    ),
    merchantId: process.env.CLOVER_MERCHANT_ID ?? "",
    clientId: process.env.CLOVER_CLIENT_ID ?? "",
    // Merchant API Token for POC: Developer Dashboard → Test Merchants → <merchant> → API Token
    // Used as `Authorization: Bearer <token>` for GET /v3/merchants/{mId}/items/{itemId}
    apiToken: process.env.CLOVER_API_TOKEN ?? "",
  },

  zkong: {
    apiBase: requireEnv("ZKONG_API_BASE", "https://esl-eu.zkong.com"),
    account: process.env.ZKONG_ACCOUNT ?? "",
    password: process.env.ZKONG_PASSWORD ?? "",
    merchantId: process.env.ZKONG_MERCHANT_ID ?? "",
    agencyId: process.env.ZKONG_AGENCY_ID ?? "",
    // Zkong store id, required only for strategy/list polling (visibility of
    // active promos). Empty disables the strategy poll.
    storeId: process.env.ZKONG_STORE_ID ?? "",
  },

  zkongPollIntervalMs: parseInt(process.env.ZKONG_POLL_INTERVAL_MS ?? "60000", 10),

  // The "Clover Auth Code" shown under Your Apps > App Settings > Webhooks
  // in the Clover Developer Dashboard. Clover includes this exact value in
  // the `X-Clover-Auth` header on every webhook POST after the callback URL
  // has been verified. It is a static shared value (not a per-request HMAC
  // signature) -- verification is a constant-time string comparison against
  // this header. See src/webhooks/handlers/clover.ts.
  cloverAuthCode: process.env.CLOVER_AUTH_CODE ?? "",
};
