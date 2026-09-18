# Maintainer Specification

Status: **current** for `0.1.x`.

This document defines the invariants maintainers must preserve. User setup and examples belong in [README.md](README.md) and `docs/`; historical experiments live in `_reference/` and are not the public contract.

## Product boundary

`deepseek-web-api` is an unofficial, local, text-only adapter from OpenAI-compatible HTTP requests to an authenticated `chat.deepseek.com` Web session.

Required public routes:

- `POST /v1/responses`
- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /health`

The project does not claim complete OpenAI parity, official DeepSeek support, or safe public-Internet deployment.

## Runtime constraints

- pnpm + TypeScript ESM
- Node.js >= 20
- `node:http`; no heavyweight server framework
- system Chrome/Chromium through `playwright-core`
- every `src/**/*.ts` file <= 300 physical lines
- strict TypeScript; no `any` at protocol/business boundaries
- no real-account login test in default CI

## Security invariants

- Default bind is `127.0.0.1`.
- Every `/v1/*` route requires a configured API key; `/health` remains open.
- API keys use timing-safe comparison.
- `auth.json`, `.api-key`, `sessions.json`, and Chrome profile data are owner-local runtime state.
- Credential files are written with restrictive modes and atomic replacement where applicable.
- Tokens/cookies are never logged.
- Client-provided unknown session IDs are not trusted as reusable upstream sessions.
- Repository and package contents must exclude `.env`, `data/`, auth/session/key files, and Chrome profiles.

## Login contract

Startup must prefer a valid persisted `auth.json` without opening a browser. If saved auth fails:

1. connect to configured CDP;
2. launch a dedicated local Chrome profile only for the default local CDP path;
3. open a visible window for interactive login;
4. require token, `ds_session_id`, and an authenticated API probe;
5. dump token/cookies atomically;
6. hydrate managed headless contexts from saved auth on later use.

Login failures must be visible and actionable; do not mask them with stale defaults.

## DeepSeek completion contract

Each request must resolve server-side:

- `model_type`: `default` or `expert`;
- `thinking_enabled`: boolean;
- `search_enabled`: false for expert mode;
- trusted session ID and `parent_message_id`;
- current auth and PoW response;
- compatibility prompt.

The completion body remains aligned with the observed Web contract:

```json
{
  "chat_session_id": "...",
  "parent_message_id": null,
  "model_type": "default",
  "prompt": "...",
  "ref_file_ids": [],
  "thinking_enabled": true,
  "search_enabled": false,
  "action": null,
  "preempt": false
}
```

A non-2xx upstream response is an upstream failure and must not be converted into a fabricated successful completion.

## PoW contract

- Create a challenge for `/api/v0/chat/completion`.
- Solve the observed `DeepSeekHashV1` challenge in an authenticated page worker.
- Send base64-encoded JSON in `x-ds-pow-response`.
- Keep the worker URL configurable through `DS_POW_JS`.
- Treat changed challenge/worker behavior as a protocol break requiring diagnosis.

## Prompt compatibility contract

The prompt builder must preserve:

- top-level `instructions` / `system`;
- message roles `system` and `developer` as instruction context;
- user/assistant/tool/function history;
- Responses `message`, `function_call`, and `function_call_output` history;
- current tool/function definitions, choice, and parallel-call preference;
- AGENTS.md, skills, and extension/MCP-backed tool context when supplied by clients such as Pi.

Replayed Responses `reasoning` items are assistant-internal state and must not become user turns.

For a reused upstream session, send only turns after the last stored assistant boundary, while restating current instructions and tool policy each turn. A simple one-user request with no extra context should remain the original text.

## Session contract

Session identity is model-agnostic. Switching flash/pro, search where allowed, or thinking must not fork a safely matched session.

Resolution priority:

1. explicit persisted conversation/session ID;
2. adapter-issued `previous_response_id`;
3. exact normalized history fingerprint;
4. conservative history prefix/assistant-tail match;
5. new session.

Persist:

- last upstream `response_message_id`;
- normalized turns;
- instruction/tool fingerprints;
- latest model type for diagnostics;
- fingerprint-to-session index.

Writes must be atomic. One session is not concurrency-safe; document this rather than hiding branches with retries.

## Responses API contract

Non-streaming responses may include:

- `reasoning` item;
- assistant `message` item;
- `function_call` item(s);
- `output_text` convenience field;
- metadata with session and upstream lineage;
- upstream output token count.

Streaming must include:

- `response.created`;
- `response.in_progress`;
- output item add/delta/done events;
- exactly one live reasoning delta family for the same text;
- `response.completed` on success;
- standard top-level `error` event on streamed failure;
- final `[DONE]` marker after success.

Tool calls can be buffered until protocol parsing is safe. Tool-only output must not create an empty assistant message item.

`previous_response_id` is a local continuation handle, not OpenAI `store` semantics. Retrieval/cancel/delete/background APIs are out of scope for `0.1.x`.

## Chat Completions contract

- Stream and non-stream modes are required.
- Final text maps to `content`.
- Thinking maps to `reasoning_content`.
- Parsed tools map to `tool_calls` with `finish_reason: "tool_calls"`.
- Streaming ends with `[DONE]`.
- Responses include local `conversation` and `previous_response_id` continuation hints.
- Standard unsupported sampling/storage fields may be ignored, but must not be documented as honored.

## Tool-call contract

Tool calling is explicitly prompt-based. The requested canonical model output is:

```text
<tool_call>
{"name":"tool_name","arguments":{"key":"value"}}
</tool_call>
```

The parser may accept observed malformed variants at the untrusted output boundary, but generated prompts and stored canonical history must use one stable format. Tool-call IDs must be deterministic for a response seed and payload.

When a tool call appears only in reasoning, promote the structured call without leaking raw tags. `DS_TOOL_REASONING=hidden` is the safe default; `clean` may expose only protocol-cleaned reasoning.

## Documentation contract

Public behavior changes must update the relevant documents:

- `README.md`: project entry, quick start, warning, API summary, environment/security
- `docs/architecture.md`: login, PoW, request chain, mapping, trust boundaries
- `docs/api.md`: supported/ignored/unsupported fields
- `docs/responses-api.md`: event and output semantics
- `docs/pi.md`: both Pi API modes and tool/history behavior
- `docs/troubleshooting.md`: actionable failure diagnosis
- `CHANGELOG.md`: release-visible changes

Do not claim 100% OpenAI compatibility or native DeepSeek function calling.

## Verification gate

Every non-trivial change must pass:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Release preparation additionally requires:

- `pnpm install --frozen-lockfile` succeeds;
- package dry-run contains only intended public files;
- ignored credential/runtime paths are absent from Git;
- CI passes on Node.js 20 and 22;
- README, LICENSE, security policy, changelog, and release notes match the shipped version.
