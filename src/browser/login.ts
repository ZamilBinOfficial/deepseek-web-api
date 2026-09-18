/** Validates and reuses DeepSeek login state, waiting for interactive login only when required. */
import type { Cookie, Page } from "playwright-core";

import { CLIENT_HEADERS, COMPLETION_PATH } from "../config/constants.js";
import type { AppConfig } from "../config/env.js";
import type { DeepSeekAuth } from "../deepseek/types.js";
import type { Logger } from "../utils/logger.js";
import { dumpAuth, loadAuth, readUserToken, tryLoadAuth } from "./authDump.js";
import type { ChromeManager } from "./chrome.js";

/** Probe challenge API from Node using a saved auth snapshot. */
async function nodeAuthWorks(baseUrl: string, auth: DeepSeekAuth): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v0/chat/create_pow_challenge`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
        cookie: auth.cookie,
        origin: baseUrl,
        referer: `${baseUrl}/`,
        ...CLIENT_HEADERS,
      },
      body: JSON.stringify({ target_path: COMPLETION_PATH }),
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) return false;
    if (!("code" in data) || !("data" in data)) return false;
    const nested = data.data;
    if (typeof nested !== "object" || nested === null || !("biz_code" in nested)) return false;
    return data.code === 0 && nested.biz_code === 0;
  } catch {
    return false;
  }
}

/** Probe a side-effect-free challenge endpoint to reject stale browser tokens. */
const API_TOKEN_WORKS_SCRIPT = `async ({ authorization, headers, completionPath }) => {
  try {
    const response = await fetch("/api/v0/chat/create_pow_challenge", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ target_path: completionPath }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    if (typeof data !== "object" || data === null) return false;
    if (!("code" in data) || !("data" in data)) return false;
    const nested = data.data;
    if (typeof nested !== "object" || nested === null || !("biz_code" in nested)) return false;
    return data.code === 0 && nested.biz_code === 0;
  } catch {
    return false;
  }
}`;

async function apiTokenWorks(page: Page, token: string): Promise<boolean> {
  return page.evaluate(
    async ({ script, arg }) => (0, eval)("(" + script + ")")(arg),
    {
      script: API_TOKEN_WORKS_SCRIPT,
      arg: {
        authorization: `Bearer ${token}`,
        headers: CLIENT_HEADERS,
        completionPath: COMPLETION_PATH,
      },
    },
  );
}

function cookiesForContext(auth: DeepSeekAuth, baseUrl: string): Cookie[] {
  if (auth.cookies.length > 0) {
    return auth.cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
  }
  // Fallback: parse cookie header when snapshot only has the joined string.
  const host = new URL(baseUrl).hostname;
  return auth.cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      const name = eq >= 0 ? part.slice(0, eq) : part;
      const value = eq >= 0 ? part.slice(eq + 1) : "";
      return {
        name,
        value,
        domain: host,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax" as const,
      };
    });
}

/** Coordinates login probing, user-visible waiting, and auth snapshot refreshes. */
export class LoginManager {
  private cachedAuth: DeepSeekAuth | null = null;
  private hydrated = false;

  constructor(
    private readonly chrome: ChromeManager,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Prefer saved auth.json without opening a browser.
   * Only open a visible DeepSeek window when interactive login is required.
   */
  async ensureLoggedIn(): Promise<DeepSeekAuth> {
    const saved = tryLoadAuth(this.config.authFile);
    if (saved && (await nodeAuthWorks(this.config.baseUrl, saved))) {
      this.cachedAuth = saved;
      this.logger.info("已复用 data/auth.json 登录态（无需打开浏览器）");
      return saved;
    }

    const page = await this.chrome.deepSeekPage({
      visible: true,
      openDeepSeek: true,
    });
    const existing = await this.probe(page);
    if (existing) {
      this.cachedAuth = existing;
      this.logger.info("已复用 Chrome 中的 DeepSeek 登录态");
      return existing;
    }

    await page.bringToFront().catch(() => undefined);
    this.logger.info("请在打开的浏览器中登录 DeepSeek… 登录成功后自动继续");
    while (true) {
      await page.waitForTimeout(1_500);
      const auth = await this.probe(page);
      if (auth) {
        this.cachedAuth = auth;
        this.logger.info("DeepSeek 登录成功，已保存认证信息", { file: this.config.authFile });
        return auth;
      }
    }
  }

  /** Prefer cached/file auth; browser dump is best-effort and never clobbers a good snapshot. */
  async dumpCurrent(): Promise<DeepSeekAuth> {
    const fallback = this.cachedAuth ?? tryLoadAuth(this.config.authFile);
    if (this.chrome.isConnected()) {
      try {
        const page = await this.chrome.deepSeekPage({
          visible: this.config.showBrowser,
          openDeepSeek: true,
        });
        if (fallback) await this.hydrate(page, fallback);
        const auth = await dumpAuth(
          await this.chrome.context(),
          page,
          this.config.authFile,
          this.config.baseUrl,
        );
        this.cachedAuth = auth;
        return auth;
      } catch {
        if (fallback) {
          this.cachedAuth = fallback;
          return fallback;
        }
      }
    }
    if (fallback) {
      this.cachedAuth = fallback;
      return fallback;
    }
    return loadAuth(this.config.authFile);
  }

  /** Headless page for PoW; injects auth.json so empty profiles still work. */
  async page(): Promise<Page> {
    const page = await this.chrome.deepSeekPage({
      visible: this.config.showBrowser,
      openDeepSeek: true,
    });
    const auth = this.cachedAuth ?? tryLoadAuth(this.config.authFile);
    if (auth) await this.hydrate(page, auth);
    return page;
  }

  /** Write token + cookies into the managed browser once per connection. */
  private async hydrate(page: Page, auth: DeepSeekAuth): Promise<void> {
    if (this.hydrated && this.chrome.isConnected()) {
      const existing = await readUserToken(page);
      if (existing) return;
    }
    const context = await this.chrome.context();
    const cookies = cookiesForContext(auth, this.config.baseUrl);
    if (cookies.length) await context.addCookies(cookies);
    if (!page.url().startsWith(this.config.baseUrl)) {
      await page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    await page.evaluate(
      async ({ script, token }) => (0, eval)("(" + script + ")")(token),
      {
        script: `(token) => { localStorage.setItem("userToken", JSON.stringify({ value: token })); }`,
        token: auth.token,
      },
    );
    this.hydrated = true;
    this.logger.debug("已将 auth.json 注入 headless Chrome");
  }

  private async probe(page: Page): Promise<DeepSeekAuth | null> {
    const token = await readUserToken(page);
    if (!token) return null;
    const context = await this.chrome.context();
    const works = await apiTokenWorks(page, token);
    if (!works) return null;
    this.logger.info("DeepSeek session token verified successfully!");
    return dumpAuth(context, page, this.config.authFile, this.config.baseUrl);
  }
}
