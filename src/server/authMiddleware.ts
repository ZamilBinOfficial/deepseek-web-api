/** Generates, extracts, and verifies the API key protecting every /v1 route. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import { writeJson } from "../utils/http.js";

export interface ApiKeyInfo {
  keys: string[];
  source: "env" | "file" | "generated";
}

/** Split DS_API_KEY on commas/whitespace; file keys are one per line. */
export function parseApiKeys(raw: string, mode: "env" | "file"): string[] {
  const parts = mode === "env" ? raw.split(/[,\s]+/) : raw.split(/\r?\n/);
  return [...new Set(parts.map((part) => part.trim()).filter((part) => part && !part.startsWith("#")))];
}

/** Reuse environment/file keys or generate one persistent owner-only key. */
export function loadApiKey(file: string, envKey = process.env.DS_API_KEY): ApiKeyInfo {
  const configured = envKey?.trim();
  if (configured) {
    const keys = parseApiKeys(configured, "env");
    if (keys.length) return { keys, source: "env" };
  }
  if (fs.existsSync(file)) {
    const keys = parseApiKeys(fs.readFileSync(file, "utf8"), "file");
    if (keys.length) return { keys, source: "file" };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const key = `sk-ds-${randomBytes(24).toString("hex")}`;
  fs.writeFileSync(file, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  return { keys: [key], source: "generated" };
}

export function extractApiKey(headers: IncomingHttpHeaders): string {
  const headerKey = headers["x-api-key"];
  const first = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  if (first) return first.trim();
  const authorization = headers.authorization;
  if (!authorization) return "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] ?? authorization).trim();
}

/** Use constant-time comparison after checking length to reduce timing leakage. */
export function apiKeysEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isApiKeyAuthorized(headers: IncomingHttpHeaders, expected: string | readonly string[]): boolean {
  const provided = extractApiKey(headers);
  const keys = typeof expected === "string" ? [expected] : expected;
  return keys.some((key) => apiKeysEqual(provided, key));
}

/** Write the OpenAI-style 401 response when request authentication fails. */
export function requireApiKey(
  request: IncomingMessage,
  response: ServerResponse,
  expected: string | readonly string[],
): boolean {
  const valid = isApiKeyAuthorized(request.headers, expected);
  if (valid) return true;
  writeJson(response, 401, {
    error: {
      message: "Invalid API key. Use Authorization: Bearer <key> or x-api-key.",
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  });
  return false;
}
