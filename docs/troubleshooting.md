# Troubleshooting

Start with the full local verification command:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

For runtime issues, set `DS_DEBUG=1` only while diagnosing. Debug output must still be sanitized before sharing.

## Login and Chrome

### The server waits for login forever

A usable login requires all of the following in the managed DeepSeek page:

- a readable `localStorage.userToken`;
- a non-empty `ds_session_id` cookie;
- a successful authenticated Web API probe.

Log in inside the dedicated window opened by this project. Logging in only in another normal Chrome profile does not populate `data/chrome-profile/`.

Run the explicit login command:

```bash
pnpm login
```

### Saved `auth.json` is rejected

The token or cookies may have expired or the file may be malformed. Re-run `pnpm login`. Do not hand-edit token/cookie fields unless debugging against current DeepSeek behavior.

If you need to reset state, stop the server and **back up** the affected runtime files before moving them aside. Never attach the backup to an issue.

### Chrome cannot be found

Set an explicit executable:

```bash
DS_CHROME_PATH="/path/to/Google Chrome" pnpm start
```

The path must point to Chrome or Chromium itself, not an application directory.

### CDP connection fails

- Confirm `DS_CDP` is an HTTP endpoint such as `http://127.0.0.1:9333`.
- Check that the port is not occupied by another process.
- A custom remote CDP endpoint is not replaced by a locally launched browser when it fails.
- Extension-heavy or incompatible CDP browsers may be rejected; use the dedicated managed profile.
- Remove stale profile locks only while Chrome is stopped. The runtime already clears known stale locks for its managed profile.

### Chrome opens every request

The normal mode is headless after auth hydration. Ensure `DS_SHOW_BROWSER` is unset/false. Interactive login always uses a visible window when required.

## API authentication and HTTP

### `401 Invalid API key`

Check the key source priority:

1. `DS_API_KEY`
2. `DS_API_KEY_FILE`
3. generated `data/.api-key`

If `DS_API_KEY` is set in the server environment, it overrides the file. Use one of:

```http
Authorization: Bearer <key>
```

```http
x-api-key: <key>
```

Do not print the real key in an issue or screenshot.

### `400 invalid JSON body`

The body must be one JSON object. Check shell quoting and `Content-Type: application/json`.

### `400 empty input`

The adapter could not find text in `input`, `messages`, or `prompt`. Images/files alone are unsupported. A Responses request containing only a replayed `reasoning` item is intentionally treated as empty.

### `413 request body too large`

The HTTP JSON body limit is 1 MiB. This service is text-only; do not embed files or base64 images in requests.

### Browser client is blocked by CORS or mixed content

The server sends permissive CORS headers, but browsers still block HTTPS pages from calling insecure HTTP in some contexts. Keep the service local or put a correctly configured local TLS reverse proxy in front of it. Never expose the raw server publicly.

## DeepSeek upstream

### `DeepSeek upstream 401`

The Web token/cookies expired or rotated. Run:

```bash
pnpm login
```

If failures persist, log out and back in using the managed browser profile.

### PoW challenge or worker failure

DeepSeek may have changed its frontend worker chunk or challenge contract.

1. Confirm the managed page can load `chat.deepseek.com` and its static assets.
2. Inspect the current DeepSeek frontend/worker behavior using browser developer tools.
3. Set the current worker URL with `DS_POW_JS`.
4. Restart the process.

Do not hide PoW failures with retries or a fake header. A changed challenge normally requires a protocol update.

### Completion returns `502`

The adapter surfaces non-2xx DeepSeek completion responses as `502`. Capture the status and a sanitized message. Common causes are expired auth, invalid PoW, changed private endpoints, or upstream risk controls.

### Stream ends with no content

Enable sanitized debug logging and inspect whether the upstream produced recognized `THINK` or `RESPONSE` fragments. A changed patch/SSE shape may require an update in `src/deepseek/updates.ts`.

## Reasoning and tools

### Reasoning appears twice in Pi Responses mode

Use `0.1.0` or newer. The adapter emits only one live reasoning delta family. Clients that consume both reasoning and summary delta events would duplicate identical text if a proxy emitted both.

### Final answer is missing but reasoning exists

Current versions promote a reasoning-only final answer to normal content when there is no tool call. If this still occurs, record a sanitized upstream event shape; the fragment classifier may have changed.

### Raw `<tool_call>` text leaks into content

The model output was malformed or used an unknown protocol shape. Confirm tools were present in the request and keep the documented strict format. For Pi, leave `DS_TOOL_REASONING=hidden` unless cleaned tool-turn reasoning is specifically needed.

### The model refuses instead of calling a tool

Tool calling is prompt-simulated. Check that:

- the request includes the tool definition on the current turn;
- the tool name and JSON Schema are clear;
- `tool_choice` is represented correctly;
- the requested capability is actually available to the client;
- the model did not place malformed call JSON in reasoning.

The adapter cannot guarantee tool selection because DeepSeek Web has no native function-call enforcement.

### Tool arguments are empty or invalid

Inspect the mapped call, not raw credentials or full private prompts. The parser accepts JSON objects; non-object arguments are rejected. Tighten the tool schema/description and retry.

## Session continuity

### A second turn creates a new DeepSeek session

Continuation resolution uses explicit IDs first, then history matching.

Preferred fixes:

- pass the previous response's `previous_response_id` or `conversation`;
- keep complete and stable user/assistant/tool history;
- retain `data/sessions.json`;
- preserve assistant tool-call arguments and the matching tool result;
- avoid changing whitespace/content of earlier messages unnecessarily.

### Model switching forks the conversation

The session key is model-agnostic. If a flash/pro switch forks, the incoming history did not match a persisted session or the store was removed. Inspect sanitized session metadata, not the contents of `sessions.json` if they include private prompts.

### Concurrent turns branch upstream

Serialize requests per conversation. Two requests that reuse the same last `response_message_id` can both become children of that message. There is no per-session queue in `0.1.0`.

### `sessions.json` cannot be read or written

Check directory ownership and free space. Writes use an atomic temporary file plus rename. If the file is malformed, the server logs a warning and starts with an empty in-memory store; continuation knowledge is then lost until new turns are recorded.

## Pi-specific checks

- The provider `baseUrl` must end in `/v1`.
- `apiKey` must resolve in the environment that launched Pi.
- Use `supportsUsageInStreaming: false` for `openai-completions`.
- Use `supportsStrictMode: false` for `openai-responses`.
- Pi/MCP tools must reach the request as ordinary function schemas; this server is not an MCP server.
- Keep `reasoning: true` if you want Pi's thinking controls, while remembering that levels collapse to on/off.

See [pi.md](pi.md) for complete configurations.

## Reporting a reproducible issue

Include:

- commit or release version;
- operating system, Node.js, pnpm, and Chrome/Chromium versions;
- endpoint, model, streaming mode, and client;
- a minimal sanitized request shape;
- exact sanitized error/status;
- whether a fresh login or new session changes the result.

Never include `.env`, `auth.json`, `.api-key`, `sessions.json`, cookies, tokens, or Chrome profile files. Use private vulnerability reporting for security defects.
