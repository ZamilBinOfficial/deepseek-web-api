# Architecture

`deepseek-web-api` is a local protocol adapter. It accepts a subset of OpenAI-compatible HTTP requests, uses an authenticated `chat.deepseek.com` browser session to call DeepSeek Web's private completion endpoint, and maps the streamed result back to Responses API or Chat Completions shapes.

It is not an OpenAI-to-DeepSeek official gateway and does not use the official DeepSeek API.

## Components

```text
OpenAI-compatible client
        |
        v
node:http server -> API-key middleware -> Responses / Chat adapter
        |                                      |
        |                                      v
        |                           prompt + model + session mapping
        |                                      |
        v                                      v
SessionStore <-> DeepSeekClient -> LoginManager -> ChromeManager / CDP
                                      |
                                      v
                           DeepSeek Web auth + PoW + completion SSE
                                      |
                                      v
                           update parser -> OpenAI-compatible output
```

- `src/server/`: `node:http` server, route dispatch, CORS, body limits, and API-key enforcement.
- `src/api/`: transport adapters for Responses, Chat Completions, and Models.
- `src/browser/`: Chrome discovery/launch, CDP connection, login probing, and auth snapshot persistence.
- `src/deepseek/`: model selection, session lineage, PoW, upstream completion, SSE normalization, prompt construction, and tool-call mapping.
- `src/config/` and `src/utils/`: validated runtime configuration and small boundary helpers.

## Login state

The runtime needs two pieces of DeepSeek Web state:

1. `localStorage.userToken`
2. Cookies for `chat.deepseek.com`, including a valid `ds_session_id`

Startup follows this order:

1. Read `data/auth.json` (or `DS_AUTH_FILE`).
2. Validate the saved token/cookies against the Web API without opening Chrome.
3. If invalid or absent, connect to `DS_CDP`.
4. If the default local CDP endpoint is unavailable, launch a dedicated Chrome/Chromium profile under `data/chrome-profile/`.
5. Open a visible DeepSeek page only when interactive login is required.
6. After the token, cookie, and API probe succeed, atomically write `auth.json` with owner-only permissions.
7. For later headless work, hydrate the managed browser context from the saved snapshot.

The dedicated profile avoids mixing automation state with a user's normal Chrome profile. `auth.json` is still a credential and must be protected like a session token.

## Request path

For each completion request, `DeepSeekClient`:

1. Resolves the public model ID to DeepSeek Web's `model_type` (`default` or `expert`).
2. Resolves thinking to the upstream boolean `thinking_enabled`.
3. Resolves Web search; `expert` mode always disables it because the Web client does not support that combination.
4. Resolves an existing session from an explicit conversation ID, `previous_response_id`, or normalized request history.
5. Builds one compatibility prompt containing current instructions, tool definitions, and only the conversation turns not already represented by the reused DeepSeek session.
6. Refreshes browser-derived auth.
7. Prepares or reuses the DeepSeek chat session and solves the current PoW challenge.
8. Sends `POST /api/v0/chat/completion` with the session ID and the last stored `response_message_id` as `parent_message_id`.
9. Parses DeepSeek SSE updates and maps them to the requested OpenAI-compatible transport.
10. Atomically persists the new session lineage in `data/sessions.json`.

## PoW

DeepSeek Web requires a proof-of-work value for completion requests. The adapter calls the Web challenge endpoint with the completion path as the target, then executes the current `DeepSeekHashV1` worker code inside an authenticated browser page. The solution is encoded in the `x-ds-pow-response` header.

The worker URL is a private frontend implementation detail. `DS_POW_JS` exists because DeepSeek can replace the chunk without notice. A PoW failure is treated as upstream incompatibility, not hidden with retries or fabricated defaults.

## Reasoning and output mapping

DeepSeek's stream uses fragment types rather than OpenAI output items:

| DeepSeek fragment | Normalized channel | Responses API | Chat Completions |
| --- | --- | --- | --- |
| `THINK` | reasoning | `reasoning` output item and `response.reasoning_text.delta` | `reasoning_content` |
| `RESPONSE` | final text | assistant `message` and `response.output_text.delta` | `content` |
| `SEARCH` / `SEARCH_REF` | reasoning/search note | reasoning text | `reasoning_content` |

The update parser tracks the active fragment so content-only append patches remain in the correct channel. If an upstream final answer appears only in `THINK`, the adapter promotes it to normal content instead of returning an empty answer.

## Tool-call compatibility

DeepSeek Web does not expose native OpenAI function calling. The adapter therefore:

1. Serializes current tool/function definitions and tool-choice policy into the compatibility prompt.
2. Requires the model to emit strict `<tool_call>` JSON blocks.
3. Accepts several observed malformed variants defensively at the output boundary.
4. Converts valid calls to Chat Completions `tool_calls` or Responses `function_call` items.
5. Stores a canonical assistant tool-call representation so a later tool result can match the correct DeepSeek session.

This is a prompt compatibility layer, not a guarantee that the model will choose a tool or produce valid arguments. When tools are enabled, the adapter buffers enough upstream output to remove protocol text before emitting structured tool calls.

## Session continuity

`SessionStore` is deliberately model-agnostic. Switching flash/pro or changing thinking does not create a new DeepSeek session when the request can be matched safely.

Resolution priority:

1. Explicit `chat_session_id`, `conversation`, or metadata conversation ID.
2. `previous_response_id` in this adapter's `resp_<session-id>` form.
3. Exact normalized conversation fingerprint.
4. Conservative prefix or last-assistant matching.
5. New DeepSeek session.

The stored `lastResponseMessageId` is the trusted upstream parent. Client-provided unknown session IDs are never sent upstream as reusable sessions until the adapter has a persisted entry.

A single session is not concurrency-safe: parallel requests can share the same parent and branch upstream. Clients should serialize turns per conversation.

## Security boundaries

Trusted server-side values:

- API keys loaded from environment or the owner-only key file.
- Persisted session IDs and parent message IDs.
- Server-resolved model/search/thinking options.
- Browser-derived token and cookies.

Untrusted inputs:

- All HTTP JSON fields and headers.
- Client-provided session IDs and history.
- DeepSeek SSE frames and tool-call text.
- Browser-evaluated values crossing back into Node.js.

Default safety posture:

- Bind to `127.0.0.1`.
- Require an API key for every `/v1/*` route.
- Keep runtime credentials under ignored `data/` paths with restrictive file modes.
- Do not log token/cookie contents.
- Do not run real-account browser tests in CI.

See [SECURITY.md](../SECURITY.md) for disclosure and deployment guidance.
