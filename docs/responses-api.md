# Responses API behavior

`POST /v1/responses` implements the text, reasoning, and function-call surfaces needed by common OpenAI-compatible clients. It is a compatibility adapter over one DeepSeek Web completion stream, not a complete OpenAI Responses service.

## Request normalization

The adapter accepts:

- `input` as a string;
- message arrays with `system`, `developer`, `user`, or `assistant` roles;
- Responses `message` items with `input_text` or `output_text` content;
- Responses `function_call` and `function_call_output` history;
- `instructions` and top-level `system` compatibility fields;
- `previous_response_id` and local conversation/session identifiers.

Replayed Responses `reasoning` items are ignored during prompt construction. They are assistant-internal state, not user input. This matters for Pi and other clients that persist a completed reasoning item and replay it with later messages.

## Final response object

Depending on upstream output, `output` can contain:

### Reasoning

```json
{
  "type": "reasoning",
  "id": "resp_<session>_reasoning",
  "summary": [{ "type": "summary_text", "text": "..." }],
  "content": [{ "type": "reasoning_text", "text": "..." }]
}
```

### Assistant message

```json
{
  "type": "message",
  "id": "resp_<session>_message",
  "role": "assistant",
  "status": "completed",
  "content": [{ "type": "output_text", "text": "..." }]
}
```

### Function call

```json
{
  "type": "function_call",
  "id": "fc_<stable-hash>",
  "call_id": "call_<stable-hash>",
  "name": "read",
  "arguments": "{"path":"README.md"}",
  "status": "completed"
}
```

`output_text` contains only visible assistant message text. A tool-only response therefore has an empty `output_text` and one or more `function_call` items.

## Streaming framing

The HTTP response uses standard SSE framing:

```text
event: response.output_text.delta
data: {"type":"response.output_text.delta",...}

```

Every JSON event includes a monotonically increasing `sequence_number`. After the terminal event, the server writes:

```text
data: [DONE]

```

## Normal text event order

A response with reasoning and final text is emitted in this order:

1. `response.created`
2. `response.in_progress`
3. `response.output_item.added` for the reasoning item
4. `response.content_part.added` for reasoning content
5. zero or more `response.reasoning_text.delta`
6. `response.output_item.added` for the assistant message
7. `response.content_part.added` for output text
8. zero or more `response.output_text.delta`
9. reasoning/text done events and `response.output_item.done`
10. `response.completed`
11. `[DONE]`

The adapter deliberately emits one live reasoning delta family. Some clients, including Pi, consume both `response.reasoning_text.delta` and `response.reasoning_summary_text.delta`; emitting identical text through both would duplicate streaming thinking.

The completed reasoning item still includes both a `summary` and `content` representation for broad non-streaming compatibility.

## Reasoning-only upstream answers

DeepSeek can occasionally place a final answer in `THINK` without producing a `RESPONSE` fragment. When there is no valid tool call and no final response text, the adapter promotes that text to a normal assistant message:

- no reasoning output item is emitted;
- one `response.output_text.delta`/message is emitted;
- the text is stored as the assistant turn for session matching.

This avoids blank content and avoids showing the same text as both reasoning and final output.

## Function-call streaming

Tool calling is prompt-based, so the adapter must first collect enough upstream text to parse and remove the protocol. For each parsed call it emits:

1. `response.output_item.added` with an in-progress `function_call` and empty `arguments`;
2. `response.function_call_arguments.delta`;
3. `response.function_call_arguments.done`;
4. `response.output_item.done` with the completed call.

Multiple calls receive continuous `output_index` values. If the model emits ordinary final text before calls, the message item comes first.

Because parsing happens after buffering, tool-call deltas are structurally streamed but may arrive near the end of the upstream response rather than token-by-token.

## Tool result continuation

A client continues a tool round by sending prior calls plus one or more `function_call_output` items:

```json
{
  "model": "deepseek-v4-flash",
  "input": [
    {
      "type": "function_call",
      "call_id": "call_123",
      "name": "get_weather",
      "arguments": "{"city":"Hefei"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_123",
      "output": "{"temperature":32}"
    },
    {
      "role": "user",
      "content": [{ "type": "input_text", "text": "Summarize it." }]
    }
  ],
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "parameters": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ]
}
```

The session store canonicalizes the assistant call and tool result so this request can reuse the existing DeepSeek session and parent message.

## `previous_response_id`

The adapter returns IDs in the form:

```text
resp_<deepseek-session-id>
```

Passing that ID back resolves the persisted local session and its last upstream parent message. This is not OpenAI-hosted response storage:

- there is no `GET /v1/responses/{id}`;
- `store` has no effect;
- the handle can remain stable for multiple turns in the same DeepSeek session;
- deleting `data/sessions.json` removes local continuation knowledge.

Clients may instead send full normalized history, which the session store attempts to match conservatively.

## Reasoning levels

OpenAI-compatible fields are accepted, but DeepSeek Web exposes only a boolean:

| Client value | Upstream |
| --- | --- |
| `none`, `off`, `0`, `false`, `disabled` | `thinking_enabled: false` |
| any other level or omitted default | `thinking_enabled: true` |

The response metadata includes `thinking_levels_supported: false` to make this limitation explicit.

## Error events

If a failure occurs after streaming headers are sent, the terminal event is:

```text
event: error
data: {"type":"error","code":"deepseek_web_error","message":"...","param":null}

```

No fabricated `response.completed` event is sent after an error.

## Compatibility limits

Supported well:

- text input/output;
- system/developer instructions;
- streaming output and reasoning;
- function-call/function-result history;
- session continuation;
- Pi's OpenAI Responses stream processor.

Not implemented:

- background responses;
- response retrieval/cancellation/deletion;
- images, files, audio, or video;
- strict tool schema enforcement;
- hosted OpenAI tools;
- encrypted reasoning;
- prompt caching semantics;
- reliable input-token accounting;
- OpenAI `store` semantics.
