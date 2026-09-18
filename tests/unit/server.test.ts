/** Verifies the documented behavior of the corresponding production module. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";

import { ChromeManager } from "../../src/browser/chrome.js";
import { LoginManager } from "../../src/browser/login.js";
import type { AppConfig } from "../../src/config/env.js";
import { DeepSeekClient } from "../../src/deepseek/client.js";
import { SessionStore } from "../../src/deepseek/sessionStore.js";
import { createServer } from "../../src/server/createServer.js";
import { createLogger } from "../../src/utils/logger.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function testClient(): DeepSeekClient {
  const dataDir = mkdtempSync(path.join(tmpdir(), "deepseek-web-api-test-"));
  const config: AppConfig = {
    port: 8787,
    host: "127.0.0.1",
    cdpEndpoint: "http://127.0.0.1:9333",
    dataDir,
    authFile: path.join(dataDir, "auth.json"),
    apiKeyFile: path.join(dataDir, ".api-key"),
    sessionsFile: path.join(dataDir, "sessions.json"),
    chromeProfileDir: path.join(dataDir, "chrome-profile"),
    powWorkerUrl: "https://example.com/pow.js",
    baseUrl: "https://chat.deepseek.com",
    debug: false,
    toolReasoning: "hidden",
    showBrowser: false,
  };
  const logger = createLogger(false);
  const chrome = new ChromeManager(config, logger);
  const login = new LoginManager(chrome, config, logger);
  return new DeepSeekClient(config, login, new SessionStore(), logger);
}

async function baseUrl(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server address");
  return `http://127.0.0.1:${address.port}`;
}

describe("HTTP server routes", () => {
  it("keeps health open and protects /v1 routes", async () => {
    const server = createServer({ client: testClient(), apiKeys: ["secret", "also-secret"], debug: false });
    const url = await baseUrl(server);
    expect(await fetch(`${url}/health`).then((response) => response.json())).toEqual({ ok: true });
    expect((await fetch(`${url}/v1/models`)).status).toBe(401);
    const models = await fetch(`${url}/v1/models`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(models.status).toBe(200);
    expect(await models.json()).toMatchObject({ object: "list" });
    const alt = await fetch(`${url}/v1/models`, { headers: { "x-api-key": "also-secret" } });
    expect(alt.status).toBe(200);
  });
});
