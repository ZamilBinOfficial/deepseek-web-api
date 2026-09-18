#!/usr/bin/env node
/** CLI entry point for login bootstrap and the local HTTP server. */
import fs from "node:fs";
import type { Server } from "node:http";

import { LoginManager } from "./browser/login.js";
import { ChromeManager } from "./browser/chrome.js";
import { loadConfig } from "./config/env.js";
import { DeepSeekClient } from "./deepseek/client.js";
import { SessionStore } from "./deepseek/sessionStore.js";
import { loadApiKey } from "./server/authMiddleware.js";
import { createServer } from "./server/createServer.js";
import { errorMessage } from "./utils/errors.js";
import { createLogger } from "./utils/logger.js";
import { isRecord } from "./utils/json.js";

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function buildRuntime() {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const logger = createLogger(config.debug);
  const chrome = new ChromeManager(config, logger);
  const login = new LoginManager(chrome, config, logger);
  const sessions = new SessionStore(config.sessionsFile, logger);
  const client = new DeepSeekClient(config, login, sessions, logger);
  return { config, logger, client };
}

/** Validate login before listening so the first API request is immediately usable. */
async function start(): Promise<void> {
  const { config, logger, client } = await buildRuntime();
  const apiKey = loadApiKey(config.apiKeyFile);
  await client.initialize();
  const server = createServer({ client, apiKeys: apiKey.keys, debug: config.debug });
  await listen(server, config.port, config.host);
  logger.info(`deepseek-web-api 已启动：http://${config.host}:${config.port}`);
  logger.info("路由：POST /v1/responses、POST /v1/chat/completions、GET /v1/models、GET /health");
  logger.info("API key", { count: apiKey.keys.length, file: config.apiKeyFile, source: apiKey.source });
  logger.info("Chrome CDP", { endpoint: config.cdpEndpoint });

  const shutdown = (signal: string): void => {
    logger.info(`收到 ${signal}，正在停止服务`);
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

/** Ensure browser authentication and exit after refreshing data/auth.json. */
async function login(): Promise<void> {
  const { config, logger, client } = await buildRuntime();
  await client.initialize();
  logger.info("认证信息已写入", { file: config.authFile });
}

function packageVersion(): string {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  return isRecord(parsed) && typeof parsed.version === "string" ? parsed.version : "unknown";
}

function help(): void {
  console.log(
    `deepseek-web-api\n\nUsage:\n  deepseek-web-api start\n  deepseek-web-api login\n  deepseek-web-api --version\n`,
  );
}

async function main(): Promise<void> {
  const command = process.argv[2] || "start";
  if (command === "start") await start();
  else if (command === "login") await login();
  else if (command === "help" || command === "--help" || command === "-h") help();
  else if (command === "version" || command === "--version" || command === "-v") {
    console.log(packageVersion());
  } else throw new Error(`未知命令：${command}`);
}

void main()
  .then(() => {
    if ((process.argv[2] || "start") === "login") process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(`deepseek-web-api: ${errorMessage(error)}`);
    process.exit(1);
  });
