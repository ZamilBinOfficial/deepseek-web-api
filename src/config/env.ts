/** Resolves runtime configuration and all secret-bearing data paths. */
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_POW_WORKER_URL,
  DEEPSEEK_BASE_URL,
} from "./constants.js";

export type ToolReasoningMode = "hidden" | "clean";

export interface AppConfig {
  port: number;
  host: string;
  cdpEndpoint: string;
  dataDir: string;
  authFile: string;
  apiKeyFile: string;
  sessionsFile: string;
  chromeProfileDir: string;
  chromePath?: string;
  powWorkerUrl: string;
  baseUrl: string;
  debug: boolean;
  toolReasoning: ToolReasoningMode;
  /** Show Chrome UI. Default false (headless). Login always opens a visible window when needed. */
  showBrowser: boolean;
}

/** Load KEY=VALUE lines from .env without overriding existing process.env. */
export function loadDotEnv(cwd = process.cwd()): void {
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envPath(name: string, fallback: string): string {
  const configured = process.env[name]?.trim();
  return path.resolve(configured || fallback);
}

function parseToolReasoning(raw: string | undefined): ToolReasoningMode {
  const value = raw?.trim() || "clean";
  if (value !== "hidden" && value !== "clean") {
    throw new Error(`Invalid DS_TOOL_REASONING: ${value}; expected hidden or clean`);
  }
  return value;
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${raw ?? ""}`);
  }
  return port;
}

/** Build a validated configuration; loads .env once if present. */
export function loadConfig(cwd = process.cwd()): AppConfig {
  loadDotEnv(cwd);
  const dataDir = envPath("DS_DATA_DIR", path.join(cwd, "data"));
  const chromePath = process.env.DS_CHROME_PATH?.trim();
  return {
    port: parsePort(process.env.PORT),
    host: process.env.HOST?.trim() || "127.0.0.1",
    cdpEndpoint: process.env.DS_CDP?.trim() || DEFAULT_CDP_ENDPOINT,
    dataDir,
    authFile: envPath("DS_AUTH_FILE", path.join(dataDir, "auth.json")),
    apiKeyFile: envPath("DS_API_KEY_FILE", path.join(dataDir, ".api-key")),
    sessionsFile: envPath("DS_SESSION_FILE", path.join(dataDir, "sessions.json")),
    chromeProfileDir: envPath("DS_CHROME_PROFILE", path.join(dataDir, "chrome-profile")),
    ...(chromePath ? { chromePath } : {}),
    powWorkerUrl: process.env.DS_POW_JS?.trim() || DEFAULT_POW_WORKER_URL,
    baseUrl: process.env.DS_BASE_URL?.trim() || DEEPSEEK_BASE_URL,
    debug: /^(1|true|yes|on)$/i.test(process.env.DS_DEBUG || ""),
    toolReasoning: parseToolReasoning(process.env.DS_TOOL_REASONING),
    showBrowser: /^(1|true|yes|on)$/i.test(process.env.DS_SHOW_BROWSER || ""),
  };
}
