import axios from "axios";
import { config } from "../../config/env";
import { encryptPassword } from "../../utils/rsa";

interface LoginResponseData {
  token: string;
  currentUser?: {
    id: number;
    account: string;
    agencyId?: number;
    merchantId?: number;
  };
  // other fields from login response omitted
}

interface ApiEnvelope<T> {
  success: boolean;
  code: number;
  message: string;
  data: T;
  translate?: boolean;
}

let cachedToken: string | null = null;
let tokenFetchedAt: number | null = null;
// Token is documented as valid for 7 days (section 2.2).
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Refresh a bit early to avoid edge-case expiry mid-request.
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

function isTokenFresh(): boolean {
  if (!cachedToken || tokenFetchedAt === null) return false;
  return Date.now() - tokenFetchedAt < TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS;
}

export async function getZkongToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && isTokenFresh() && cachedToken) {
    return cachedToken;
  }

  const base = config.zkong.apiBase.replace(/\/$/, "");

  // 1. Get RSA public key
  const keyRes = await axios.get<ApiEnvelope<string>>(
    `${base}/zk/user/getErpPublicKey`,
    { timeout: 10_000 }
  );
  if (!keyRes.data.success || !keyRes.data.data) {
    throw new Error(
      `getErpPublicKey failed: ${keyRes.data.code} ${keyRes.data.message}`
    );
  }
  const publicKeyBase64 = keyRes.data.data.trim();

  // 2. Encrypt password
  const encryptedPassword = encryptPassword(
    publicKeyBase64,
    config.zkong.password
  );

  // 3. Login
  const loginRes = await axios.post<ApiEnvelope<LoginResponseData>>(
    `${base}/zk/user/login`,
    {
      account: config.zkong.account,
      password: encryptedPassword,
      loginType: 3,
    },
    {
      timeout: 10_000,
      headers: { "Content-Type": "application/json;charset=utf-8" },
    }
  );

  if (!loginRes.data.success || !loginRes.data.data?.token) {
    throw new Error(
      `zkong login failed: ${loginRes.data.code} ${loginRes.data.message}`
    );
  }

  cachedToken = loginRes.data.data.token;
  tokenFetchedAt = Date.now();
  console.log("[zkong] login successful, token cached");

  return cachedToken;
}

export function clearZkongToken(): void {
  cachedToken = null;
  tokenFetchedAt = null;
}
