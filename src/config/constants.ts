/** Shared DeepSeek Web protocol constants used by browser and Node-side requests. */
export const DEEPSEEK_BASE_URL = "https://chat.deepseek.com";
export const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9333";
export const DEFAULT_POW_WORKER_URL =
  "https://fe-static.deepseek.com/chat/static/76608.8f2a9fa413.js";
export const COMPLETION_PATH = "/api/v0/chat/completion";
export const CLIENT_HEADERS = {
  "x-client-platform": "web",
  "x-client-version": "2.2.0",
  "x-client-locale": "zh_CN",
  "x-client-bundle-id": "com.deepseek.chat",
} as const;
