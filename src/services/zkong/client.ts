import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";
import { config } from "../../config/env";
import { getZkongToken, clearZkongToken } from "./auth";

let axiosInstance: AxiosInstance | null = null;

function getAxios(): AxiosInstance {
  if (axiosInstance) return axiosInstance;

  const base = config.zkong.apiBase.replace(/\/$/, "");
  axiosInstance = axios.create({
    baseURL: base,
    timeout: 15_000,
    headers: { "Content-Type": "application/json;charset=utf-8" },
  });

  // Attach Authorization header from cached token on every request
  axiosInstance.interceptors.request.use(
    async (req: InternalAxiosRequestConfig) => {
      const token = await getZkongToken();
      req.headers.set("Authorization", token);
      return req;
    }
  );

  // On 401, clear cache, re-login once, and retry
  axiosInstance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config as AxiosRequestConfig & {
        _zkongRetried?: boolean;
      };
      if (
        error.response?.status === 401 &&
        original &&
        !original._zkongRetried
      ) {
        original._zkongRetried = true;
        clearZkongToken();
        console.warn("[zkong] 401 received, refreshing token and retrying");
        try {
          const newToken = await getZkongToken(true);
          // re-attach header with fresh token
          const headers = (original.headers as Record<string, string>) ?? {};
          headers["Authorization"] = newToken;
          original.headers = headers;
          return axiosInstance!.request(original);
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return Promise.reject(error);
    }
  );

  return axiosInstance;
}

/**
 * Thin wrapper around the authenticated axios instance.
 * Handles token injection + 401 -> re-login -> retry-once automatically.
 */
export const zkongClient = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig) {
    return getAxios().get<T>(url, config);
  },
  post<T = unknown>(url: string, data?: unknown, cfg?: AxiosRequestConfig) {
    return getAxios().post<T>(url, data, cfg);
  },
  put<T = unknown>(url: string, data?: unknown, cfg?: AxiosRequestConfig) {
    return getAxios().put<T>(url, data, cfg);
  },
  delete<T = unknown>(url: string, cfg?: AxiosRequestConfig) {
    return getAxios().delete<T>(url, cfg);
  },
};
