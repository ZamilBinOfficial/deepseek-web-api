/** Solves DeepSeekHashV1 in the authenticated page and creates sessions only when needed. */
import type { Page } from "playwright-core";

import { CLIENT_HEADERS, COMPLETION_PATH } from "../config/constants.js";
import type { ModelType } from "./types.js";

export interface PreparedCompletion {
  token: string;
  powHeader: string;
  sessionId: string;
  modelType: ModelType;
  reused: boolean;
}

/**
 * Browser script kept as a plain string so tsx/esbuild never injects __name helpers
 * into Playwright page.evaluate payloads.
 */
const PREPARE_SCRIPT = `async ({ powWorkerUrl, modelType, fallbackToken, sessionId, reuseSession, headers, targetPath }) => {
  const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  let token = fallbackToken;
  const rawToken = localStorage.getItem("userToken");
  if (rawToken) {
    try {
      const parsed = JSON.parse(rawToken);
      if (record(parsed) && typeof parsed.value === "string") token = parsed.value;
      else if (typeof parsed === "string") token = parsed;
    } catch {
      token = rawToken;
    }
  }
  if (!token) throw new Error("no DeepSeek userToken; run deepseek-web-api login");
  const authHeaders = {
    authorization: "Bearer " + token,
    "content-type": "application/json",
    ...headers,
  };

  const challengeResponse = await fetch("/api/v0/chat/create_pow_challenge", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ target_path: targetPath }),
  });
  const challengeBody = await challengeResponse.json();
  const challengeRoot = record(challengeBody) ? challengeBody : null;
  const challengeData = challengeRoot && record(challengeRoot.data) ? challengeRoot.data : null;
  const challengeBizData = challengeData && record(challengeData.biz_data) ? challengeData.biz_data : null;
  const challenge = challengeBizData && record(challengeBizData.challenge) ? challengeBizData.challenge : null;
  if (
    !challengeResponse.ok ||
    !challengeRoot ||
    challengeRoot.code !== 0 ||
    !challengeData ||
    challengeData.biz_code !== 0 ||
    !challenge
  ) {
    throw new Error("pow challenge failed: " + JSON.stringify(challengeBody));
  }

  const workerResponse = await fetch(powWorkerUrl);
  if (!workerResponse.ok) throw new Error("pow worker fetch failed: " + workerResponse.status);
  const workerSource = await workerResponse.text();
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
  const answer = await new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("pow timeout"));
    }, 120000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      const message = record(event.data) ? event.data : null;
      const value = message && record(message.answer) ? message.answer : null;
      if (message && message.type === "pow-answer" && value) resolve(value);
      else reject(new Error("pow failed: " + JSON.stringify(event.data)));
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "pow worker error"));
    };
    worker.postMessage({
      type: "pow-challenge",
      challenge: {
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        difficulty: challenge.difficulty,
        signature: challenge.signature,
        expireAt: challenge.expire_at,
      },
    });
  }).finally(() => URL.revokeObjectURL(workerUrl));

  const encoded = new TextEncoder().encode(JSON.stringify({
    algorithm: answer.algorithm,
    challenge: answer.challenge,
    salt: answer.salt,
    answer: answer.answer,
    signature: answer.signature,
    target_path: targetPath,
  }));
  let binary = "";
  for (const byte of encoded) binary += String.fromCharCode(byte);
  const powHeader = btoa(binary);

  let resolvedSessionId = sessionId;
  if (!reuseSession || !resolvedSessionId) {
    const sessionResponse = await fetch("/api/v0/chat_session/create", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const sessionBody = await sessionResponse.json();
    const sessionRoot = record(sessionBody) ? sessionBody : null;
    const sessionData = sessionRoot && record(sessionRoot.data) ? sessionRoot.data : null;
    const sessionBizData = sessionData && record(sessionData.biz_data) ? sessionData.biz_data : null;
    const session = sessionBizData && record(sessionBizData.chat_session) ? sessionBizData.chat_session : null;
    resolvedSessionId = session && typeof session.id === "string" ? session.id : null;
    if (!sessionResponse.ok || !resolvedSessionId) {
      throw new Error("session create failed: " + JSON.stringify(sessionBody));
    }
  }

  return {
    token,
    powHeader,
    sessionId: resolvedSessionId,
    modelType,
    reused: Boolean(reuseSession && sessionId),
  };
}`;

/**
 * Prepare one completion with a fresh PoW proof. Existing known sessions are reused;
 * otherwise the page creates exactly one new DeepSeek session.
 */
export async function prepareCompletion(input: {
  page: Page;
  powWorkerUrl: string;
  modelType: ModelType;
  fallbackToken: string;
  sessionId: string | null;
  reuseSession: boolean;
}): Promise<PreparedCompletion> {
  const { page, ...payload } = input;
  return page.evaluate(
    async ({ script, arg }) => (0, eval)("(" + script + ")")(arg),
    {
      script: PREPARE_SCRIPT,
      arg: { ...payload, headers: CLIENT_HEADERS, targetPath: COMPLETION_PATH },
    },
  ) as Promise<PreparedCompletion>;
}
