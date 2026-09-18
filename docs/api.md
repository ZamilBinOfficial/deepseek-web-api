# API compatibility

The server implements a practical text-only subset of OpenAI's Responses API and Chat Completions API. It is designed for common OpenAI-compatible clients, but it does not claim complete wire or behavioral parity with OpenAI.

Base URL:

```text
http://127.0.0.1:8787/v1
```

## Authentication

Every `/v1/*` request requires one of:

```http
Authorization: Bearer <api-key>
```

```http
x-api-key: <api-key>
```

`GET /health` is intentionally unauthenticated. The API key comes from `DS_API_KEY`, `DS_API_KEY_FILE`, or the generated `data/.api-key` file.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/responses` | Responses API compatible text response |
| `POST` | `/v1/chat/completions` | Chat Completions compatible text response |
| `GET` | `/v1/models` | Public model aliases |
| `GET` | `/health` | Process health only; does not probe DeepSeek on every call |

## Models

| Public ID | Aliases | DeepSeek Web `model_type` | Search |
| --- | --- | --- | --- |
| `deepseek-v4-flash` | `flash`, `default`, `deepseek-chat` | `default` | supported |
| `deepseek-v4-pro` | `pro`, `expert`, `deepseek-reasoner` | `expert` | forced off |

Unknown model strings containing `pro` or `expert` resolve to expert mode; other unknown strings resolve to flash mode. Clients should use the two public IDs returned by `/v1/models`.

## Responses API

### Commonly supported request fields

| Field | Behavior |
| --- | --- |
| `model` | Resolves to flash/default or pro/expert. |
| `input` | String, message array, Responses message items, `function_call`, and `function_call_output` text history. |
| `instructions` / `system` | Included in the compatibility prompt. |
| system/developer input messages | Included as instructions and restated on every turn. |
| `stream` | `true` returns SSE; otherwise returns one completed response object. |
| `reasoning.effort`, `reasoning_effort`, `thinking_level` | Mapped to DeepSeek's boolean thinking switch. `none`, `off`, `0`, `false`, and `disabled` turn it off. |
| `thinking_enabled`, `reasoning_enabled` | Direct boolean compatibility fields. |
| `tools` | Function definitions are prompt-injected. A tool whose type contains `web` or `search` also enables DeepSeek Web search in flash mode. |
| `tool_choice`, `parallel_tool_calls` | Expressed in the compatibility prompt; not enforced by a native upstream tool API. |
| `previous_response_id` | Continues a persisted DeepSeek session when it is an ID issued by this adapter. |
| `conversation`, `chat_session_id`, metadata conversation IDs | Explicit local continuation hints. |

Responses `reasoning` items replayed by clients are treated as assistant-internal state and are not converted into user turns. Assistant `message`, `function_call`, and `function_call_output` items remain part of the matching history.

### Accepted but not implemented as OpenAI features

Unknown JSON fields are generally ignored rather than rejected. Fields such as `store`, `include`, `temperature`, `top_p`, `max_output_tokens`, `service_tier`, `prompt_cache_key`, `background`, `truncation`, and text-format controls do not currently change the DeepSeek Web request.

This leniency helps SDKs that send standard defaults, but clients must not assume those controls are honored.

### Non-streaming response

A completed object contains:

- `id`, `object: "response"`, `created_at`, `status`, and `model`
- `output`: optional `reasoning`, assistant `message`, and/or `function_call` items
- `output_text`: final visible assistant text
- `usage`: upstream output token count; input tokens are `0`
- `metadata.chat_session_id`: local continuation identifier
- `metadata.request_message_id` and `metadata.response_message_id`: upstream lineage diagnostics
- optional `title` from the DeepSeek stream

Example:

```json
{
  "id": "resp_<session-id>",
  "object": "response",
  "status": "completed",
  "model": "deepseek-v4-flash",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "status": "completed",
      "content": [{ "type": "output_text", "text": "Hello" }]
    }
  ],
  "output_text": "Hello",
  "usage": { "input_tokens": 0, "output_tokens": 1, "total_tokens": 1 },
  "metadata": { "chat_session_id": "<session-id>" }
}
```

See [responses-api.md](responses-api.md) for the event sequence and function-call details.

## Chat Completions

### Commonly supported request fields

| Field | Behavior |
| --- | --- |
| `model` | Same model resolver as Responses. |
| `messages` | `system`, `developer`, `user`, `assistant`, `tool`, and `function` text history. |
| `stream` | `true` returns `chat.completion.chunk` SSE frames followed by `[DONE]`. |
| `tools` / `functions` | Prompt-based tool compatibility. |
| `tool_choice` / `function_call` | Included in the compatibility prompt. |
| reasoning/thinking compatibility fields | Mapped to the upstream boolean thinking switch. |
| `conversation`, `chat_session_id`, `previous_response_id` | Session continuation hints. |

`temperature`, token limits, penalties, stop sequences, logprobs, response formats, seed, and other sampling fields are currently accepted but not applied upstream.

### Non-streaming response

Normal text appears in `choices[0].message.content`. Reasoning appears in the widely used non-standard `choices[0].message.reasoning_content` field. Parsed calls appear in `choices[0].message.tool_calls` with `finish_reason: "tool_calls"`.

The response also includes:

- `conversation`: DeepSeek session ID
- `previous_response_id`: Responses-style continuation handle

### Streaming response

Text chunks use:

```json
{
  "choices": [{
    "index": 0,
    "delta": { "content": "..." },
    "finish_reason": null
  }]
}
```

Reasoning chunks use `delta.reasoning_content`. Tool calls use `delta.tool_calls`, and the final chunk sets `finish_reason` to `tool_calls` or `stop`.

The server does not emit a separate usage-only streaming chunk. Configure clients such as Pi with `supportsUsageInStreaming: false` when available.

## Tool-call mapping

Function calling is simulated through a text protocol because DeepSeek Web has no native OpenAI function tool endpoint.

Expected model output:

```text
<tool_call>
{"name":"read","arguments":{"path":"README.md"}}
</tool_call>
```

Valid calls become:

- Chat Completions: `assistant.tool_calls[]`
- Responses: `output[]` item with `type: "function_call"`

Tool result history is accepted as Chat `role: "tool"`/`"function"` or Responses `function_call_output`. The parser also recognizes several malformed shapes observed in real model output, but the documented strict shape is the only one prompts should request.

## Session semantics

This adapter's response ID is a continuation handle derived from the DeepSeek session. It is not an OpenAI-hosted stored response. `previous_response_id` therefore means “continue the persisted local DeepSeek session,” not “retrieve an OpenAI response object.”

Clients that send complete history can continue without `previous_response_id`; the session store matches normalized user/assistant/tool history. Model and thinking changes do not intentionally fork a matched session.

Do not send concurrent turns against one conversation.

## Errors

Non-streaming errors use an OpenAI-style object:

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error",
    "code": "..."
  }
}
```

Responses streaming errors use a top-level event payload:

```json
{
  "type": "error",
  "code": "deepseek_web_error",
  "message": "...",
  "param": null
}
```

Upstream HTTP failures are surfaced as `502`. Invalid JSON/input is `400`, oversized bodies are `413`, and invalid API keys are `401`.

## Not supported

- Image, audio, video, or file input/upload
- OpenAI-hosted background responses and response retrieval/cancel/delete endpoints
- Native structured output / JSON schema enforcement
- Native function calling or guaranteed parallel calls
- Built-in OpenAI tools such as code interpreter, computer use, or file search
- Reliable input-token accounting
- Concurrent mutation of a single DeepSeek session
