#!/usr/bin/env node
/**
 * Clear local DeepSeek login state so the next start/login opens a browser.
 * Keeps API keys and sessions.json unless --sessions is passed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadDotEnv(cwd) {
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

function resolvePath(name, fallback) {
  const configured = process.env[name]?.trim();
  return path.resolve(configured || fallback);
}

function rm(target) {
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function killChromeForProfile(profileDir) {
  if (process.platform === "win32") return;
  // Match the managed Chrome launched with this exact user-data-dir.
  const pattern = `user-data-dir=${profileDir}`;
  spawnSync("pkill", ["-f", pattern], { stdio: "ignore" });
}

function main() {
  const cwd = process.cwd();
  loadDotEnv(cwd);
  const clearSessions = process.argv.includes("--sessions");
  const dataDir = resolvePath("DS_DATA_DIR", path.join(cwd, "data"));
  const authFile = resolvePath("DS_AUTH_FILE", path.join(dataDir, "auth.json"));
  const chromeProfileDir = resolvePath("DS_CHROME_PROFILE", path.join(dataDir, "chrome-profile"));
  const sessionsFile = resolvePath("DS_SESSION_FILE", path.join(dataDir, "sessions.json"));
  const cdpFile = path.join(dataDir, "chrome.cdp");

  killChromeForProfile(chromeProfileDir);

  const removed = [];
  if (rm(authFile)) removed.push(path.relative(cwd, authFile) || authFile);
  if (rm(cdpFile)) removed.push(path.relative(cwd, cdpFile) || cdpFile);
  if (rm(chromeProfileDir)) removed.push(path.relative(cwd, chromeProfileDir) || chromeProfileDir);
  if (clearSessions && rm(sessionsFile)) {
    removed.push(path.relative(cwd, sessionsFile) || sessionsFile);
  }

  if (removed.length === 0) {
    console.log("登录态已是空的（无 auth.json / chrome-profile / chrome.cdp）");
  } else {
    console.log("已清除登录态：");
    for (const item of removed) console.log(`  - ${item}`);
  }
  if (!clearSessions) {
    console.log("保留 sessions.json 与 API key；需要一并清会话索引时加 --sessions");
  }
  console.log("下次 pnpm dev / pnpm start / pnpm login 将弹出浏览器登录。");
}

main();
