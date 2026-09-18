/** Reads browser auth state and writes the sensitive auth snapshot atomically. */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Cookie, Page } from "playwright-core";

import type { DeepSeekAuth } from "../deepseek/types.js";
import { isRecord } from "../utils/json.js";

/** Handle both historical raw tokens and the current JSON-wrapped localStorage value. */
const READ_USER_TOKEN_SCRIPT = `() => {
  const raw = localStorage.getItem("userToken");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "value" in parsed) {
      return typeof parsed.value === "string" ? parsed.value : null;
    }
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return raw;
  }
}`;

export async function readUserToken(page: Page): Promise<string | null> {
  return page.evaluate(
    async ({ script }) => (0, eval)("(" + script + ")")(),
    { script: READ_USER_TOKEN_SCRIPT },
  );
}

/** Export the current token and cookie header with owner-only file permissions. */
export async function dumpAuth(
  context: BrowserContext,
  page: Page,
  file: string,
  baseUrl: string,
): Promise<DeepSeekAuth> {
  const token = await readUserToken(page);
  if (!token) throw new Error("DeepSeek localStorage 中没有 userToken，请先登录");
  const cookies = await context.cookies();
  const auth: DeepSeekAuth = {
    token,
    cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    cookies,
    dumped_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(auth, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  return auth;
}

function parseCookie(value: unknown): Cookie | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== "string" ||
    typeof value.value !== "string" ||
    typeof value.domain !== "string" ||
    typeof value.path !== "string" ||
    typeof value.expires !== "number" ||
    typeof value.httpOnly !== "boolean" ||
    typeof value.secure !== "boolean" ||
    !["Strict", "Lax", "None"].includes(String(value.sameSite))
  ) return null;
  const sameSite = value.sameSite === "Strict" ? "Strict" : value.sameSite === "Lax" ? "Lax" : "None";
  return {
    name: value.name,
    value: value.value,
    domain: value.domain,
    path: value.path,
    expires: value.expires,
    httpOnly: value.httpOnly,
    secure: value.secure,
    sameSite,
  };
}

/** Validate a persisted auth snapshot before using it at a trust boundary. */
export function loadAuth(file: string): DeepSeekAuth {
  const auth = tryLoadAuth(file);
  if (!auth) {
    if (!fs.existsSync(file)) throw new Error(`缺少 ${file}；请运行 deepseek-web-api login`);
    throw new Error(`${file} 格式无效；请重新运行 deepseek-web-api login`);
  }
  return auth;
}

/** Return null instead of throwing when auth is missing or invalid. */
export function tryLoadAuth(file: string): DeepSeekAuth | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(parsed) || typeof parsed.token !== "string" || typeof parsed.cookie !== "string") {
      return null;
    }
    return {
      token: parsed.token,
      cookie: parsed.cookie,
      cookies: Array.isArray(parsed.cookies)
        ? parsed.cookies.map(parseCookie).filter((cookie): cookie is Cookie => cookie !== null)
        : [],
      dumped_at: typeof parsed.dumped_at === "string" ? parsed.dumped_at : "",
    };
  } catch {
    return null;
  }
}
