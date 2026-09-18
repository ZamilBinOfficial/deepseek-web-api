# Pi integration

This guide configures [Pi](https://github.com/badlogic/pi-mono) to use `deepseek-web-api` as a custom provider. The configuration shape follows Pi's custom-model implementation current at this project's `0.1.0` release on July 25, 2026.

Pi supports both relevant API modes:

- `openai-completions`: recommended default; the broadest OpenAI-compatible path.
- `openai-responses`: supported; preserves Responses reasoning items and function-call events.

## 1. Start the local server

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Complete browser login if prompted, then export the generated local API key before starting Pi:

```bash
export DEEPSEEK_WEB_API_KEY="$(cat /absolute/path/to/deepseek-web-api/data/.api-key)"
```

The base URL used by Pi must include `/v1`:

```text
http://127.0.0.1:8787/v1
```

## 2. Chat Completions configuration (recommended)

Add this provider to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "deepseek-web": {
      "baseUrl": "http://127.0.0.1:8787/v1",
      "api": "openai-completions",
      "apiKey": "$DEEPSEEK_WEB_API_KEY",
      "compat": {
        "supportsDeveloperRole": true,
        "supportsReasoningEffort": true,
        "supportsUsageInStreaming": false,
        "supportsStore": false
      },
      "models": [
        {
          "id": "deepseek-v4-flash",
          "name": "DeepSeek Web Flash",
          "reasoning": true,
          "input": ["text"],
          "thinkingLevelMap": {
            "off": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": null,
            "max": null
          },
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        },
        {
          "id": "deepseek-v4-pro",
          "name": "DeepSeek Web Pro",
          "reasoning": true,
          "input": ["text"],
          "thinkingLevelMap": {
            "off": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": null,
            "max": null
          },
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        }
      ]
    }
  }
}
```

Why these compatibility flags:

- `supportsDeveloperRole: true`: this adapter consumes both `system` and `developer` messages.
- `supportsReasoningEffort: true`: Pi may send `reasoning_effort`; the adapter maps all non-off levels to DeepSeek Web's boolean thinking switch.
- `supportsUsageInStreaming: false`: Chat streaming does not emit a separate usage chunk.
- `supportsStore: false`: this is local DeepSeek session persistence, not OpenAI `store` behavior.

Use Pi's `/model` selector to choose the provider and model.

## 3. Responses API configuration

To exercise `/v1/responses`, add a second provider:

```json
{
  "providers": {
    "deepseek-web-responses": {
      "baseUrl": "http://127.0.0.1:8787/v1",
      "api": "openai-responses",
      "apiKey": "$DEEPSEEK_WEB_API_KEY",
      "compat": {
        "supportsDeveloperRole": true,
        "supportsStrictMode": false,
        "supportsLongCacheRetention": false,
        "sessionAffinityFormat": "openai"
      },
      "models": [
        {
          "id": "deepseek-v4-flash",
          "name": "DeepSeek Web Flash (Responses)",
          "reasoning": true,
          "input": ["text"],
          "thinkingLevelMap": {
            "off": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": null,
            "max": null
          },
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        },
        {
          "id": "deepseek-v4-pro",
          "name": "DeepSeek Web Pro (Responses)",
          "reasoning": true,
          "input": ["text"],
          "thinkingLevelMap": {
            "off": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": null,
            "max": null
          },
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        }
      ]
    }
  }
}
```

Pi may add standard Responses fields such as `store: false`, `prompt_cache_key`, `max_output_tokens`, `include`, or session-affinity headers. The adapter accepts and ignores unsupported controls instead of rejecting the request.

`supportsStrictMode: false` is important: tool calling here is prompt-based and cannot guarantee strict JSON Schema enforcement.

## API-key alternatives

Pi can resolve model configuration values from environment variables, shell commands, or literals. Environment variables are safest for a session.

If desired, `apiKey` can invoke a command:

```json
{
  "apiKey": "!cat /absolute/path/to/deepseek-web-api/data/.api-key"
}
```

Use an absolute path. Do not paste the key into a repository-level `.pi/settings.json` or commit it in `models.json` backups.

## How Pi context reaches DeepSeek

### System prompt, AGENTS.md, and skills

Pi assembles its system prompt from its core instructions, discovered `AGENTS.md`/`CLAUDE.md` context, enabled skills, and extension-provided additions. Depending on the selected model/API, Pi sends that prompt as a `developer` or `system` message.

The adapter:

- extracts both roles as trusted instruction text for the current request;
- restates those instructions on every DeepSeek turn instead of relying on upstream session memory;
- does not reduce the request to only the newest user sentence when structured context is present.

Skills themselves are a Pi feature. When a skill tells Pi to call `read`, `bash`, a browser, or another tool, the resulting schema and call history use the same compatibility path described below.

### Tools and MCP-backed tools

Pi sends available tools as OpenAI function schemas. If a Pi extension or MCP bridge exposes MCP capabilities as Pi tools, this adapter sees ordinary function definitions; it does not implement MCP transport itself.

The tool round is:

1. Pi sends system/developer context, tool schemas, and conversation history.
2. The adapter writes the tool policy and definitions into the DeepSeek prompt.
3. DeepSeek emits one or more `<tool_call>` blocks.
4. The adapter maps them to Chat `tool_calls` or Responses `function_call` items.
5. Pi executes the tool.
6. Pi sends the assistant call and tool result back in history.
7. The adapter canonicalizes that history, matches the existing DeepSeek session, and sends only the new tool-result turn upstream.

This preserves tool-call history across both APIs, including Responses `function_call` / `function_call_output` items.

### Responses reasoning replay

Pi stores completed Responses reasoning items as internal assistant state and may replay them on the next request. The adapter ignores those replayed `reasoning` items when building the user-visible conversation, while retaining assistant messages and function-call history. This prevents prior chain-of-thought text from becoming a fake user instruction.

### Multi-turn and model switching

Pi usually sends full message history. The session store matches normalized history and reuses the saved `parent_message_id`. Switching between `deepseek-v4-flash` and `deepseek-v4-pro`, or changing Pi's thinking level, does not intentionally fork the matched DeepSeek session.

For deterministic continuation:

- keep `data/sessions.json`;
- do not rewrite earlier assistant/tool text between turns;
- do not run two turns concurrently in one Pi conversation;
- when using a custom client, return `previous_response_id` or `conversation` when available.

## Thinking behavior

Pi exposes multiple thinking levels, while DeepSeek Web exposes only `thinking_enabled: boolean`.

- `off` maps to disabled.
- `minimal`, `low`, `medium`, and `high` all map to enabled.
- `xhigh` and `max` are hidden in the sample configuration because they have no distinct upstream meaning.

Chat Completions returns thinking through `reasoning_content`. Responses returns a `reasoning` output item and one live reasoning delta stream.

For tool-call turns, `DS_TOOL_REASONING=hidden` is recommended. It prevents raw tool protocol or private reasoning prose from appearing in Pi. `clean` emits reasoning after removing recognized tool-call protocol.

## Known Pi limitations

- Tool calling is simulated by prompting; invalid/missing calls remain possible.
- With tools enabled, output may be buffered until the adapter can distinguish final text from tool-call protocol.
- Images and file inputs are not supported even if a Pi tool result references them.
- Input usage remains zero because DeepSeek Web does not expose a reliable input-token count.
- OpenAI `store`, prompt caching, strict tools, structured outputs, and background responses are not implemented.
- DeepSeek Web/API changes can break login, PoW, or completion behavior independently of Pi.

## Troubleshooting Pi

### Model is unavailable in `/model`

Pi requires resolved auth for custom providers. Confirm `DEEPSEEK_WEB_API_KEY` exists in the environment that launched Pi, or use Pi's `/login`/auth configuration.

### 401 from the local server

Compare the Pi key with `data/.api-key`, and confirm the provider base URL points to the same running checkout.

### Pi shows duplicate reasoning

Use release `0.1.0` or newer. The Responses stream emits a single reasoning delta family because Pi consumes both raw-reasoning and reasoning-summary delta families.

### Tool text appears instead of a tool call

The model did not produce parseable protocol. Re-run with the same tools, keep `DS_TOOL_REASONING=hidden`, and inspect sanitized debug output. This is a model-format limitation rather than native MCP/tool execution failure.

### The second tool round starts a new session

Keep assistant `tool_calls`/Responses `function_call` items and the matching tool result in Pi history. Do not delete `data/sessions.json`. See [troubleshooting.md](troubleshooting.md#session-continuity) for diagnostics.
