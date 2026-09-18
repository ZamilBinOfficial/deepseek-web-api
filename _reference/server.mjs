import http from "http";
import fs from "fs";
import { randomBytes } from "crypto";
import { chromium } from "playwright-core";

const PORT = Number(process.env.PORT || 8787);
const CDP = process.env.DS_CDP || "http://127.0.0.1:9333";
const AUTH_FILE = process.env.DS_AUTH_FILE || new URL("./auth.json", import.meta.url).pathname;
const API_KEY_FILE = process.env.DS_API_KEY_FILE || new URL("./.api-key", import.meta.url).pathname;
const BASE = "https://chat.deepseek.com";
const POW_JS = "https://fe-static.deepseek.com/chat/static/76608.8f2a9fa413.js";

function loadApiKey() {
  if (process.env.DS_API_KEY) return process.env.DS_API_KEY.trim();
  if (fs.existsSync(API_KEY_FILE)) {
    const k = fs.readFileSync(API_KEY_FILE, "utf8").trim();
    if (k) return k;
  }
  const k = `sk-ds-${randomBytes(24).toString("hex")}`;
  fs.writeFileSync(API_KEY_FILE, k + "\n", { mode: 0o600 });
  return k;
}

const API_KEY = loadApiKey();

function extractApiKey(req) {
  const h = req.headers || {};
  const x = h["x-api-key"];
  if (x) return String(x).trim();
  const auth = h.authorization || h.Authorization;
  if (!auth) return "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : String(auth).trim();
}

function requireApiKey(req, res) {
  const key = extractApiKey(req);
  if (!key || key !== API_KEY) {
    json(res, 401, {
      error: {
        message: "Invalid API key. Use Authorization: Bearer <key> or x-api-key.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
    return false;
  }
  return true;
}

// web model_type mapping
const MODEL_MAP = {
  "deepseek-v4-flash": "default",
  "deepseek-v4-pro": "expert",
  "deepseek-chat": "default",
  "deepseek-reasoner": "expert",
  default: "default",
  expert: "expert",
  flash: "default",
  pro: "expert",
};

function loadAuth() {
  if (!fs.existsSync(AUTH_FILE)) throw new Error(`missing ${AUTH_FILE}; run: npm run auth`);
  return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
}

function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function msgText(m) {
  if (m == null) return "";
  if (typeof m === "string") return m;
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content.map((c) => c?.text || c?.input_text || "").filter(Boolean).join("\n");
  }
  return m.text || "";
}

function latestUserText(items) {
  if (!Array.isArray(items) || !items.length) return "";
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i];
    if (typeof m === "string") return m;
    if ((m.role || "user") === "user" || m.type === "message" && (m.role || "user") === "user") {
      return msgText(m);
    }
  }
  // fallback last item
  return msgText(items[items.length - 1]);
}

function extractInputText(body) {
  if (typeof body.input === "string") return body.input;
  if (Array.isArray(body.input)) {
    // multi-turn input array: only latest user turn (history in deepseek session)
    if (body.input.some((x) => x && typeof x === "object" && (x.role || x.type === "message"))) {
      return latestUserText(body.input);
    }
    return body.input
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.content === "string") return item.content;
        if (Array.isArray(item?.content)) {
          return item.content.map((c) => c?.text || c?.input_text || "").filter(Boolean).join("\n");
        }
        return item?.text || "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(body.messages)) return latestUserText(body.messages);
  return body.prompt || "";
}

// session continuity: deepseek web stores history server-side
// key by previous_response_id / chat_session_id / messages prefix fingerprint
const sessionStore = new Map(); // sessionId -> { lastResponseMessageId, modelType, updatedAt }
const convIndex = new Map(); // convKey -> sessionId
const SESSION_FILE = process.env.DS_SESSION_FILE || new URL("./sessions.json", import.meta.url).pathname;

function loadSessionDisk() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    for (const [k, v] of Object.entries(data.sessions || {})) sessionStore.set(k, v);
    for (const [k, v] of Object.entries(data.convs || {})) convIndex.set(k, v);
  } catch {}
}
function saveSessionDisk() {
  try {
    fs.writeFileSync(
      SESSION_FILE,
      JSON.stringify(
        {
          sessions: Object.fromEntries(sessionStore),
          convs: Object.fromEntries(convIndex),
        },
        null,
        2
      )
    );
  } catch {}
}
loadSessionDisk();

function normText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function historyTurns(messages) {
  if (!Array.isArray(messages) || !messages.length) return [];
  let end = messages.length;
  // drop trailing user (current turn)
  if ((messages[end - 1]?.role || "user") === "user") end -= 1;
  return messages.slice(0, end).map((m) => ({
    role: m.role || "user",
    content: normText(msgText(m)),
  }));
}

function historyFingerprint(messages) {
  const turns = historyTurns(messages);
  if (turns.length < 1) return null;
  return turns.map((t) => `${t.role}:${t.content}`).join("\n---\n");
}

function fpKey(fp) {
  // model-agnostic: switching flash/pro/thinking must NOT fork session
  return `fp:${fp}`;
}

function turnsEqual(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].role !== b[i].role) return false;
    if (normText(a[i].content) !== normText(b[i].content)) return false;
  }
  return true;
}

function turnsPrefix(stored, incoming) {
  // incoming history is prefix of stored OR stored is prefix of incoming
  if (!stored?.length || !incoming?.length) return false;
  const n = Math.min(stored.length, incoming.length);
  for (let i = 0; i < n; i++) {
    if (stored[i].role !== incoming[i].role) return false;
    if (normText(stored[i].content) !== normText(incoming[i].content)) return false;
  }
  return true;
}

function findSessionByHistory(msgs) {
  const turns = historyTurns(msgs);
  if (!turns.length) return null;

  // 1) exact fingerprint (model-agnostic)
  const fp = turns.map((t) => `${t.role}:${t.content}`).join("\n---\n");
  const key = fpKey(fp);
  let sid = convIndex.get(key);
  if (sid && sessionStore.has(sid)) return { sessionId: sid, key };

  // 2) legacy keys with model prefix
  for (const mt of ["default", "expert", "vision"]) {
    const legacy = convIndex.get(`fp:${mt}:${fp}`);
    if (legacy && sessionStore.has(legacy)) return { sessionId: legacy, key };
  }

  // 3) match by stored turns equality / prefix (handles model switch + slight client rewrites)
  let best = null;
  for (const [id, entry] of sessionStore.entries()) {
    const st = (entry.turns || []).map((t) => ({ role: t.role, content: normText(t.content) }));
    if (!st.length) continue;
    if (turnsEqual(st, turns) || turnsPrefix(st, turns) || turnsPrefix(turns, st)) {
      const score = Math.min(st.length, turns.length);
      if (!best || score > best.score) best = { sessionId: id, score, key };
    } else {
      // last assistant message soft match
      const lastA = [...turns].reverse().find((t) => t.role === "assistant");
      const lastS = [...st].reverse().find((t) => t.role === "assistant");
      if (lastA && lastS && lastA.content && lastA.content === lastS.content) {
        const score = 0.5;
        if (!best || score > best.score) best = { sessionId: id, score, key };
      }
    }
  }
  if (best) return { sessionId: best.sessionId, key: best.key || key };

  return { sessionId: null, key, pendingFingerprint: key };
}

function resolveConversation(body, modelType) {
  // explicit session ids always win — model/thinking changes stay in same deepseek session
  const explicit =
    body.chat_session_id ||
    body.conversation ||
    body.conversation_id ||
    body.metadata?.chat_session_id ||
    body.metadata?.conversation_id;
  if (explicit && sessionStore.has(explicit)) {
    return {
      sessionId: explicit,
      parentMessageId: sessionStore.get(explicit).lastResponseMessageId ?? null,
      key: `id:${explicit}`,
    };
  }
  if (explicit) {
    return {
      sessionId: explicit,
      parentMessageId: body.parent_message_id ?? null,
      key: `id:${explicit}`,
      createIfMissing: true,
    };
  }

  // previous_response_id: resp_<uuid>
  const prev = body.previous_response_id || body.previous_response || body.metadata?.previous_response_id;
  if (prev) {
    const m = String(prev).match(/^resp_([0-9a-f-]{36})/i) || String(prev).match(/^resp_(.+)$/);
    const sid = m?.[1];
    if (sid && sessionStore.has(sid)) {
      return {
        sessionId: sid,
        parentMessageId: sessionStore.get(sid).lastResponseMessageId ?? null,
        key: `prev:${sid}`,
      };
    }
    if (sid) {
      return {
        sessionId: sid,
        parentMessageId: body.parent_message_id ?? null,
        key: `prev:${sid}`,
        createIfMissing: true,
      };
    }
  }

  // multi-turn via messages / input[] — model-agnostic match
  const msgs = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input) && body.input.some((x) => x && typeof x === "object" && x.role)
      ? body.input
      : null;
  if (msgs && msgs.length > 1) {
    const found = findSessionByHistory(msgs);
    if (found?.sessionId) {
      return {
        sessionId: found.sessionId,
        parentMessageId: sessionStore.get(found.sessionId)?.lastResponseMessageId ?? null,
        key: found.key,
      };
    }
    return {
      sessionId: null,
      parentMessageId: null,
      key: found?.key || null,
      pendingFingerprint: found?.pendingFingerprint || found?.key || null,
    };
  }

  return { sessionId: null, parentMessageId: null, key: null };
}

function rememberSession({ sessionId, modelType, responseMessageId, convKey, prompt, responseText }) {
  const prev = sessionStore.get(sessionId) || {};
  const turns = prev.turns ? [...prev.turns] : [];
  if (prompt != null && responseText != null) {
    turns.push({ role: "user", content: normText(prompt) });
    turns.push({ role: "assistant", content: normText(responseText) });
  }
  const entry = {
    ...prev,
    lastResponseMessageId: responseMessageId ?? prev.lastResponseMessageId ?? null,
    lastModelType: modelType, // last used model — NOT session identity
    modelType, // keep for debug
    updatedAt: Date.now(),
    turns: turns.slice(-40),
  };
  sessionStore.set(sessionId, entry);
  if (convKey) convIndex.set(convKey, sessionId);

  // index all prefix fingerprints so mid-history resume works; model-agnostic
  if (entry.turns?.length) {
    for (let i = 2; i <= entry.turns.length; i += 2) {
      // only index on assistant boundaries
      const slice = entry.turns.slice(0, i);
      const fp = slice.map((t) => `${t.role}:${normText(t.content)}`).join("\n---\n");
      convIndex.set(fpKey(fp), sessionId);
    }
  }
  saveSessionDisk();
}

function resolveModel(body) {
  const raw = String(body.model || "deepseek-v4-flash").toLowerCase();
  const modelType = MODEL_MAP[raw] || (raw.includes("pro") || raw.includes("expert") ? "expert" : "default");
  const publicModel = modelType === "expert" ? "deepseek-v4-pro" : "deepseek-v4-flash";
  return { modelType, publicModel, raw };
}

function resolveThinking(body) {
  // web only has boolean thinking_enabled — no real "level"
  // accept reasoning.effort / thinking / thinking_level as on/off
  if (body.thinking_enabled != null) return !!body.thinking_enabled;
  if (body.reasoning_enabled != null) return !!body.reasoning_enabled;
  if (typeof body.thinking === "boolean") return body.thinking;
  if (typeof body.reasoning === "boolean") return body.reasoning;
  const effort =
    body.reasoning?.effort ||
    body.thinking_level ||
    body.reasoning_effort ||
    body.effort;
  if (effort != null) {
    const e = String(effort).toLowerCase();
    if (["none", "off", "0", "false", "disabled"].includes(e)) return false;
    return true; // low/medium/high/max all map to on
  }
  return true;
}

function resolveSearch(body, modelType) {
  // expert mode: search unsupported on web
  if (modelType === "expert") return false;
  if (body.search_enabled != null) return !!body.search_enabled;
  if (body.web_search != null) return !!body.web_search;
  if (body.tools && Array.isArray(body.tools)) {
    return body.tools.some((t) => /search|web/i.test(t?.type || t));
  }
  return false;
}

let browserPromise = null;
async function getPage() {
  if (!browserPromise) {
    browserPromise = chromium.connectOverCDP(CDP).catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  const browser = await browserPromise;
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes("chat.deepseek.com"));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  return page;
}

/** Create pow (+ optional session) in page; return auth material for node-side streaming fetch */
async function prepareCompletion({ modelType, sessionId = null, reuseSession = false }) {
  const page = await getPage();
  const fileAuth = loadAuth();
  return await page.evaluate(
    async ({ powJs, modelType, fileToken, sessionId, reuseSession }) => {
      let token = fileToken;
      try {
        token = JSON.parse(localStorage.getItem("userToken") || "null")?.value || fileToken;
      } catch {}
      if (!token) throw new Error("no token");

      const auth = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-client-platform": "web",
        "x-client-version": "2.2.0",
        "x-client-locale": "zh_CN",
        "x-client-bundle-id": "com.deepseek.chat",
      };

      const chRes = await fetch("/api/v0/chat/create_pow_challenge", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
      }).then((r) => r.json());
      if (chRes.code !== 0 || chRes.data?.biz_code !== 0) {
        throw new Error("pow challenge failed: " + JSON.stringify(chRes));
      }
      const ch = chRes.data.biz_data.challenge;

      const src = await fetch(powJs).then((r) => r.text());
      const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
      const answer = await new Promise((resolve, reject) => {
        const w = new Worker(url);
        const t = setTimeout(() => {
          w.terminate();
          reject(new Error("pow timeout"));
        }, 120000);
        w.onmessage = (ev) => {
          clearTimeout(t);
          w.terminate();
          if (ev.data?.type === "pow-answer") resolve(ev.data.answer);
          else reject(ev.data?.error || ev.data);
        };
        w.onerror = (e) => {
          clearTimeout(t);
          reject(e.message || String(e));
        };
        w.postMessage({
          type: "pow-challenge",
          challenge: {
            algorithm: ch.algorithm,
            challenge: ch.challenge,
            salt: ch.salt,
            difficulty: ch.difficulty,
            signature: ch.signature,
            expireAt: ch.expire_at,
          },
        });
      });

      const powHeader = btoa(
        unescape(
          encodeURIComponent(
            JSON.stringify({
              algorithm: answer.algorithm,
              challenge: answer.challenge,
              salt: answer.salt,
              answer: answer.answer,
              signature: answer.signature,
              target_path: "/api/v0/chat/completion",
            })
          )
        )
      );

      let sid = sessionId;
      if (!reuseSession || !sid) {
        const sess = await fetch("/api/v0/chat_session/create", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({}),
        }).then((r) => r.json());
        sid = sess?.data?.biz_data?.chat_session?.id;
        if (!sid) throw new Error("session create failed: " + JSON.stringify(sess));
      }

      return { token, powHeader, sessionId: sid, modelType, reused: !!(reuseSession && sessionId) };
    },
    { powJs: POW_JS, modelType, fileToken: fileAuth.token, sessionId, reuseSession }
  );
}

async function openCompletionStream({
  token,
  powHeader,
  sessionId,
  modelType,
  prompt,
  thinking,
  search,
  parentMessageId = null,
}) {
  const auth = loadAuth();
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "text/event-stream",
    "x-ds-pow-response": powHeader,
    "x-client-platform": "web",
    "x-client-version": "2.2.0",
    "x-client-locale": "zh_CN",
    "x-client-bundle-id": "com.deepseek.chat",
    origin: BASE,
    referer: `${BASE}/a/chat/s/${sessionId}`,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
  if (auth.cookie) headers.cookie = auth.cookie;

  const res = await fetch(`${BASE}/api/v0/chat/completion`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: parentMessageId,
      model_type: modelType,
      prompt,
      ref_file_ids: [],
      thinking_enabled: !!thinking,
      search_enabled: !!search,
      action: null,
      preempt: false,
    }),
  });
  return res;
}

/** Async generator: yield parsed deepseek SSE data objects with optional event name */
async function* iterDeepseekSse(res) {
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`upstream ${res.status}: ${t.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!block.trim()) continue;
      let event = null;
      const dataLines = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      yield { event, data };
    }
  }
}

function makeResponseObject({ id, publicModel, sessionId, status = "in_progress" }) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: publicModel,
    output: [],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    metadata: {
      chat_session_id: sessionId,
      source: "chat.deepseek.com",
    },
  };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Consume deepseek SSE, emit OpenAI-like Responses stream events.
 * Also accumulate final fields for non-stream path.
 */
async function consumeAndMap({ upstream, publicModel, sessionId, streamRes, thinkingEnabled, searchEnabled, modelType }) {
  const id = `resp_${sessionId}`;
  const reasoningId = `${id}_reasoning`;
  const messageId = `${id}_message`;
  let thinking = "";
  let response = "";
  let title = null;
  let tokens = 0;
  let cur = "think";
  let reasoningOpened = false;
  let messageOpened = false;
  let contentPartOpened = false;
  let seq = 0;
  let requestMessageId = null;
  let responseMessageId = null;

  const emit = (event, data) => {
    if (streamRes) sseWrite(streamRes, event, data);
  };

  const responseObj = makeResponseObject({ id, publicModel, sessionId, status: "in_progress" });
  emit("response.created", { type: "response.created", response: responseObj, sequence_number: seq++ });
  emit("response.in_progress", { type: "response.in_progress", response: responseObj, sequence_number: seq++ });

  const ensureReasoning = () => {
    if (reasoningOpened) return;
    reasoningOpened = true;
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "reasoning", id: reasoningId, summary: [], content: [] },
      sequence_number: seq++,
    });
    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: reasoningId,
      output_index: 0,
      content_index: 0,
      part: { type: "reasoning_text", text: "" },
      sequence_number: seq++,
    });
  };

  const ensureMessage = () => {
    if (messageOpened) return;
    messageOpened = true;
    const outputIndex = reasoningOpened ? 1 : 0;
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: {
        type: "message",
        id: messageId,
        role: "assistant",
        status: "in_progress",
        content: [],
      },
      sequence_number: seq++,
    });
    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "" },
      sequence_number: seq++,
    });
    contentPartOpened = true;
  };

  const appendThink = (text) => {
    if (!text) return;
    ensureReasoning();
    thinking += text;
    emit("response.reasoning_text.delta", {
      type: "response.reasoning_text.delta",
      item_id: reasoningId,
      output_index: 0,
      content_index: 0,
      delta: text,
      sequence_number: seq++,
    });
    // also summary_text for clients that only read summary
    emit("response.reasoning_summary_text.delta", {
      type: "response.reasoning_summary_text.delta",
      item_id: reasoningId,
      output_index: 0,
      summary_index: 0,
      delta: text,
      sequence_number: seq++,
    });
  };

  const appendResp = (text) => {
    if (!text) return;
    ensureMessage();
    response += text;
    const outputIndex = reasoningOpened ? 1 : 0;
    emit("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      delta: text,
      sequence_number: seq++,
    });
  };

  const addFrag = (f) => {
    if (f.type === "THINK") {
      cur = "think";
      appendThink(f.content || "");
    } else if (f.type === "RESPONSE") {
      cur = "resp";
      appendResp(f.content || "");
    } else if (f.type === "SEARCH" || f.type === "SEARCH_REF") {
      // surface as reasoning annotation
      appendThink(f.content ? `\n[search] ${f.content}\n` : "\n[search]\n");
    }
  };

  for await (const { event, data } of iterDeepseekSse(upstream)) {
    if (event === "ready") {
      requestMessageId = data.request_message_id ?? requestMessageId;
      responseMessageId = data.response_message_id ?? responseMessageId;
      continue;
    }
    if (event === "title") {
      title = data.content ?? title;
      continue;
    }
    if (event === "close") break;

    if (data.v?.response) {
      for (const f of data.v.response.fragments || []) addFrag(f);
      if (data.v.response.accumulated_token_usage != null) {
        tokens = data.v.response.accumulated_token_usage;
      }
      continue;
    }

    if (data.p === "response/fragments" && data.o === "APPEND" && Array.isArray(data.v)) {
      for (const f of data.v) addFrag(f);
      continue;
    }

    if (
      (data.p === "response/fragments/-1/content" && data.o === "APPEND") ||
      (data.o === "APPEND" && data.v != null && data.p == null) ||
      (data.v != null && data.p == null && data.o == null && typeof data.v === "string")
    ) {
      if (cur === "resp") appendResp(String(data.v ?? ""));
      else appendThink(String(data.v ?? ""));
      continue;
    }

    if (data.p === "response" && data.o === "BATCH" && Array.isArray(data.v)) {
      for (const p of data.v) {
        if (p.p === "accumulated_token_usage") tokens = p.v;
      }
    }
  }

  // close items
  if (reasoningOpened) {
    emit("response.reasoning_text.done", {
      type: "response.reasoning_text.done",
      item_id: reasoningId,
      output_index: 0,
      content_index: 0,
      text: thinking,
      sequence_number: seq++,
    });
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "reasoning",
        id: reasoningId,
        summary: [{ type: "summary_text", text: thinking }],
        content: [{ type: "reasoning_text", text: thinking }],
      },
      sequence_number: seq++,
    });
  }
  if (messageOpened) {
    const outputIndex = reasoningOpened ? 1 : 0;
    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      text: response,
      sequence_number: seq++,
    });
    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: response },
      sequence_number: seq++,
    });
    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item: {
        type: "message",
        id: messageId,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: response }],
      },
      sequence_number: seq++,
    });
  }

  const output = [];
  if (thinking) {
    output.push({
      type: "reasoning",
      id: reasoningId,
      summary: [{ type: "summary_text", text: thinking }],
      content: [{ type: "reasoning_text", text: thinking }],
    });
  }
  output.push({
    type: "message",
    id: messageId,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: response }],
  });

  const final = {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: publicModel,
    output,
    output_text: response,
    usage: {
      input_tokens: 0,
      output_tokens: tokens || 0,
      total_tokens: tokens || 0,
    },
    metadata: {
      chat_session_id: sessionId,
      title,
      source: "chat.deepseek.com",
      thinking_enabled: !!thinkingEnabled,
      search_enabled: !!searchEnabled,
      model_type: modelType,
      request_message_id: requestMessageId,
      response_message_id: responseMessageId,
      // client should pass previous_response_id: this id for multi-turn
      // ponytail: web has no thinking levels; effort maps to on/off only
      thinking_levels_supported: false,
      ...(modelType === "expert" ? { search_note: "expert mode does not support search on web" } : {}),
    },
  };

  emit("response.completed", { type: "response.completed", response: final, sequence_number: seq++ });
  return { ...final, _requestMessageId: requestMessageId, _responseMessageId: responseMessageId };
}

async function runCompletion(body, { streamRes = null } = {}) {
  const prompt = extractInputText(body).trim();
  if (!prompt) throw Object.assign(new Error("empty input"), { status: 400 });

  const { modelType, publicModel } = resolveModel(body);
  const thinking = resolveThinking(body);
  let search = resolveSearch(body, modelType);
  if (modelType === "expert") search = false;

  const conv = resolveConversation(body, modelType);
  const reuse = !!(conv.sessionId && (sessionStore.has(conv.sessionId) || conv.createIfMissing));
  // if createIfMissing with unknown id — still create new, don't force invalid id
  const reuseSession = !!(conv.sessionId && sessionStore.has(conv.sessionId));

  const prep = await prepareCompletion({
    modelType,
    sessionId: reuseSession ? conv.sessionId : null,
    reuseSession,
  });

  const parentMessageId = reuseSession
    ? conv.parentMessageId ?? sessionStore.get(prep.sessionId)?.lastResponseMessageId ?? null
    : null;

  const upstream = await openCompletionStream({
    token: prep.token,
    powHeader: prep.powHeader,
    sessionId: prep.sessionId,
    modelType,
    prompt,
    thinking,
    search,
    parentMessageId,
  });

  const final = await consumeAndMap({
    upstream,
    publicModel,
    sessionId: prep.sessionId,
    streamRes,
    thinkingEnabled: thinking,
    searchEnabled: search,
    modelType,
  });

  rememberSession({
    sessionId: prep.sessionId,
    modelType,
    responseMessageId: final._responseMessageId,
    convKey: conv.key || conv.pendingFingerprint,
    prompt,
    responseText: final.output_text || "",
  });

  // strip internals
  delete final._requestMessageId;
  delete final._responseMessageId;
  final.metadata.reused_session = reuseSession;
  final.metadata.parent_message_id = parentMessageId;
  return final;
}

async function handleResponses(req, res, body) {
  const stream = body.stream === true;
  if (stream) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    try {
      await runCompletion(body, { streamRes: res });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (e) {
      if (!res.headersSent) return json(res, e.status || 500, { error: { message: String(e?.message || e) } });
      sseWrite(res, "error", { type: "error", error: { message: String(e?.message || e) } });
      res.end();
    }
    return;
  }

  try {
    const final = await runCompletion(body, { streamRes: null });
    return json(res, 200, final);
  } catch (e) {
    return json(res, e.status || 500, { error: { message: String(e?.message || e) } });
  }
}

async function handleChatCompletions(req, res, body) {
  const stream = body.stream === true;
  // non-stream: use runCompletion then wrap
  if (!stream) {
    try {
      const final = await runCompletion(body, { streamRes: null });
      const reasoning = final.output.find((o) => o.type === "reasoning");
      return json(res, 200, {
        id: `chatcmpl_${final.metadata.chat_session_id}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: final.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: final.output_text || "",
              reasoning_content: reasoning?.content?.[0]?.text || undefined,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: final.usage.total_tokens || 0,
          total_tokens: final.usage.total_tokens || 0,
        },
        // help clients continue: same as previous_response_id
        conversation: final.metadata.chat_session_id,
        previous_response_id: final.id,
      });
    } catch (e) {
      return json(res, e.status || 500, { error: { message: String(e?.message || e) } });
    }
  }

  // stream chat.completions: run upstream via same session logic, map deltas
  try {
    const prompt = extractInputText(body).trim();
    if (!prompt) return json(res, 400, { error: { message: "empty input" } });
    const { modelType, publicModel } = resolveModel(body);
    const thinking = resolveThinking(body);
    let search = resolveSearch(body, modelType);
    if (modelType === "expert") search = false;
    const conv = resolveConversation(body, modelType);
    const reuseSession = !!(conv.sessionId && sessionStore.has(conv.sessionId));
    const prep = await prepareCompletion({
      modelType,
      sessionId: reuseSession ? conv.sessionId : null,
      reuseSession,
    });
    const parentMessageId = reuseSession
      ? conv.parentMessageId ?? sessionStore.get(prep.sessionId)?.lastResponseMessageId ?? null
      : null;
    const upstream = await openCompletionStream({
      token: prep.token,
      powHeader: prep.powHeader,
      sessionId: prep.sessionId,
      modelType,
      prompt,
      thinking,
      search,
      parentMessageId,
    });

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });

    let cur = "think";
    let responseText = "";
    let responseMessageId = null;
    const id = `chatcmpl_${prep.sessionId}`;
    const created = Math.floor(Date.now() / 1000);
    const writeChunk = (delta) => {
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: publicModel,
          choices: [{ index: 0, delta, finish_reason: null }],
        })}\n\n`
      );
    };

    for await (const { event, data } of iterDeepseekSse(upstream)) {
      if (event === "ready") {
        responseMessageId = data.response_message_id ?? responseMessageId;
        continue;
      }
      if (event === "close" || event === "title") continue;
      const emitFrag = (f) => {
        if (f.type === "THINK") {
          cur = "think";
          if (f.content) writeChunk({ role: "assistant", reasoning_content: f.content });
        } else if (f.type === "RESPONSE") {
          cur = "resp";
          if (f.content) {
            responseText += f.content;
            writeChunk({ role: "assistant", content: f.content });
          }
        }
      };
      if (data.v?.response) {
        for (const f of data.v.response.fragments || []) emitFrag(f);
        continue;
      }
      if (data.p === "response/fragments" && data.o === "APPEND" && Array.isArray(data.v)) {
        for (const f of data.v) emitFrag(f);
        continue;
      }
      if (
        (data.p === "response/fragments/-1/content" && data.o === "APPEND") ||
        (data.o === "APPEND" && data.v != null && data.p == null) ||
        (data.v != null && data.p == null && data.o == null && typeof data.v === "string")
      ) {
        const t = String(data.v ?? "");
        if (!t) continue;
        if (cur === "resp") {
          responseText += t;
          writeChunk({ content: t });
        } else writeChunk({ reasoning_content: t });
      }
    }

    rememberSession({
      sessionId: prep.sessionId,
      modelType,
      responseMessageId,
      convKey: conv.key || conv.pendingFingerprint,
      prompt,
      responseText,
    });

    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: publicModel,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        conversation: prep.sessionId,
        previous_response_id: `resp_${prep.sessionId}`,
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    if (!res.headersSent) return json(res, e.status || 500, { error: { message: String(e?.message || e) } });
    res.write(`data: ${JSON.stringify({ error: { message: String(e?.message || e) } })}\n\n`);
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-api-key",
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true });
    }

    // all /v1/* require api key
    if (req.url?.startsWith("/v1/") && !requireApiKey(req, res)) return;

    if (req.method === "GET" && req.url === "/v1/models") {
      return json(res, 200, {
        object: "list",
        data: [
          { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek-web" },
          { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek-web" },
        ],
      });
    }

    if (req.method === "POST" && req.url === "/v1/responses") {
      const body = JSON.parse((await readBody(req)) || "{}");
      return await handleResponses(req, res, body);
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const body = JSON.parse((await readBody(req)) || "{}");
      return await handleChatCompletions(req, res, body);
    }

    json(res, 404, { error: { message: "not found" } });
  } catch (e) {
    if (!res.headersSent) {
      json(res, 500, { error: { message: String(e?.message || e), stack: e?.stack } });
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});

server.listen(PORT, () => {
  console.log(`deepseek web responses on http://127.0.0.1:${PORT}`);
  console.log(`POST /v1/responses  POST /v1/chat/completions  GET /v1/models  GET /health`);
  console.log(`models: deepseek-v4-flash(default) deepseek-v4-pro(expert)`);
  console.log(`api_key_file=${API_KEY_FILE}`);
  console.log(`api_key=${API_KEY}`);
  console.log(`CDP=${CDP}`);
});
