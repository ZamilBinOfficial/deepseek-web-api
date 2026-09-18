/** Verifies Chat Completions adapter maps parsed function_call items to tool_calls. */
import { describe, expect, it } from "vitest";

import { responseChatChoice } from "../../src/api/chatCompletions.js";
import type { OpenAIResponse } from "../../src/deepseek/mapResponses.js";
import { parseToolCalls } from "../../src/deepseek/toolCalls.js";

describe("chat tool mapping from hybrid model output", () => {
  it("turns Pi hybrid tool tags into OpenAI tool_calls payload shape", () => {
    const hybrid = `<_call>
<tool_call name="read">
{"arguments": {"path": "/tmp/README.md", "limit": 100}}
</tool_call>
<tool_call name="bash">
{"arguments": {"command": "ls -la", "timeout": 10}}
</tool_call>
</tool_call>`;
    const parsed = parseToolCalls(hybrid, "chatcmpl_test");
    expect(parsed.toolCalls).toHaveLength(2);

    const message = {
      role: "assistant",
      content: parsed.toolCalls.length > 0 ? parsed.content || null : parsed.content,
      tool_calls: parsed.toolCalls,
    };
    const finish_reason = parsed.toolCalls.length > 0 ? "tool_calls" : "stop";

    expect(finish_reason).toBe("tool_calls");
    expect(message.content).toBeNull();
    expect(message.tool_calls[0]).toMatchObject({
      type: "function",
      function: {
        name: "read",
        arguments: expect.stringContaining("README.md"),
      },
    });
    expect(message.tool_calls[1]?.function.name).toBe("bash");
  });

  it("maps a tool-only Responses result to null content without reasoning", () => {
    const response: OpenAIResponse = {
      id: "resp_session",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "deepseek-v4-pro",
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "bash",
          arguments: '{"command":"pwd"}',
          status: "completed",
        },
      ],
      output_text: "",
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      metadata: { chat_session_id: "session", source: "chat.deepseek.com" },
    };

    const choice = responseChatChoice(response);
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message.content).toBeNull();
    expect(choice.message).not.toHaveProperty("reasoning_content");
    expect(choice.message.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"pwd"}' },
      },
    ]);
  });
});
