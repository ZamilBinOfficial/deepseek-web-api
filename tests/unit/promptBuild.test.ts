/** Verifies compatibility prompt construction across OpenAI request shapes. */
import { describe, expect, it } from "vitest";

import { buildDeepSeekPrompt, buildToolRecoveryPrompt } from "../../src/deepseek/promptBuild.js";

describe("buildDeepSeekPrompt", () => {
  it("includes system instructions before the user turn", () => {
    const result = buildDeepSeekPrompt(
      {
        system: "Top-level safety policy.",
        messages: [
          { role: "system", content: "Follow the repository rules." },
          { role: "user", content: "Inspect the project." },
        ],
      },
      { reusedSession: false },
    );

    expect(result.prompt).toContain("[Instructions]");
    expect(result.prompt).toContain("system:\nTop-level safety policy.");
    expect(result.prompt).toContain("Follow the repository rules.");
    expect(result.prompt).toContain("user:\nInspect the project.");
  });

  it("treats developer messages as instructions", () => {
    const result = buildDeepSeekPrompt(
      {
        instructions: "Use concise answers.",
        messages: [
          { role: "developer", content: "Read AGENTS.md before editing." },
          { role: "user", content: "Continue." },
        ],
      },
      { reusedSession: false },
    );

    expect(result.prompt).toContain("instructions:\nUse concise answers.");
    expect(result.prompt).toContain("developer:\nRead AGENTS.md before editing.");
  });

  it("serializes tool schemas and the tool call protocol", () => {
    const result = buildDeepSeekPrompt(
      {
        messages: [{ role: "user", content: "What is the weather?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather by city",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          },
        ],
        tool_choice: "auto",
        parallel_tool_calls: false,
      },
      { reusedSession: false },
    );

    expect(result.prompt).toContain('"name": "get_weather"');
    expect(result.prompt).toContain("<tool_call>");
    expect(result.prompt).toContain("Tool choice: \"auto\"");
    expect(result.prompt).toContain("Parallel tool calls: disabled");
    expect(result.prompt).toContain("arguments must match the selected tool schema");
    expect(result.prompt).toContain("every string, {, and [ must be fully closed");
    expect(result.prompt).toContain("Each call must be one complete block");
    expect(result.prompt).toContain("never draft a partial call in RESPONSE");
    expect(result.prompt).toContain("Tool protocol is allowed only in the final RESPONSE channel.");
    expect(result.prompt).toContain("Never place <tool_call> blocks or tool JSON in THINK/reasoning.");
  });

  it("includes full history initially and only new tool results on reuse", () => {
    const body = {
      messages: [
        { role: "user", content: "Find the temperature." },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_old",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Hefei"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_old", content: '{"temperature":32}' },
      ],
      tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
    };
    const first = buildDeepSeekPrompt(body, { reusedSession: false });
    const reused = buildDeepSeekPrompt(body, {
      reusedSession: true,
      previous: {
        turns: first.requestTurns.slice(0, 2),
        toolsFingerprint: first.toolsFingerprint,
      },
    });

    expect(first.prompt).toContain("assistant:\n<tool_call>");
    expect(first.prompt).toContain("tool:\n[tool_call_id=call_old]");
    expect(reused.prompt).toContain('{"temperature":32}');
    expect(reused.prompt).toContain("Definitions:");
    expect(reused.prompt).not.toContain("Find the temperature.");
  });

  it("resends changed instructions while keeping stored history out of a reused prompt", () => {
    const first = buildDeepSeekPrompt(
      {
        system: "Use the old policy.",
        messages: [{ role: "user", content: "first" }],
      },
      { reusedSession: false },
    );
    const reused = buildDeepSeekPrompt(
      {
        system: "Use the new policy.",
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer" },
          { role: "user", content: "next" },
        ],
      },
      {
        reusedSession: true,
        previous: {
          turns: [
            { role: "user", content: "first" },
            { role: "assistant", content: "answer" },
          ],
          instructionFingerprint: first.instructionFingerprint,
        },
      },
    );

    expect(reused.prompt).toContain("Use the new policy.");
    expect(reused.prompt).toContain("user:\nnext");
    expect(reused.prompt).not.toContain("user:\nfirst");
  });

  it("repeats Pi instructions and current tool policy on reused weather turns", () => {
    const body = {
      system: "Follow AGENTS.md. Use tools for current data.",
      messages: [
        { role: "user", content: "先记住规则" },
        { role: "assistant", content: "好的" },
        { role: "user", content: "北京今天天气怎么样？" },
      ],
      tools: [
        { type: "function", function: { name: "bash", parameters: { type: "object" } } },
        { type: "function", function: { name: "read", parameters: { type: "object" } } },
        { type: "function", function: { name: "browser", parameters: { type: "object" } } },
      ],
      tool_choice: "auto",
    };
    const first = buildDeepSeekPrompt(body, { reusedSession: false });
    const reused = buildDeepSeekPrompt(body, {
      reusedSession: true,
      previous: {
        turns: first.requestTurns.slice(0, 2),
        instructionFingerprint: first.instructionFingerprint,
        toolsFingerprint: first.toolsFingerprint,
      },
    });

    expect(reused.prompt).toContain("Follow AGENTS.md. Use tools for current data.");
    expect(reused.prompt).toContain('"name": "bash"');
    expect(reused.prompt).toContain('"name": "browser"');
    expect(reused.prompt).toContain("real-time facts (weather, news, prices)");
    expect(reused.prompt).toContain("MUST call an available tool first");
    expect(reused.prompt).toContain("Prefer tools over refusal");
    expect(reused.prompt).toContain("user:\n北京今天天气怎么样？");
    expect(reused.prompt).not.toContain("user:\n先记住规则");
  });

  it("ignores replayed Responses reasoning while preserving Pi tool history", () => {
    const result = buildDeepSeekPrompt(
      {
        input: [
          { role: "developer", content: "Follow AGENTS.md and loaded skills." },
          {
            type: "reasoning",
            id: "rs_1",
            summary: [{ type: "summary_text", text: "private summary" }],
            content: [{ type: "reasoning_text", text: "private chain" }],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I will inspect the project." }],
          },
          {
            type: "function_call",
            call_id: "call_1",
            name: "read",
            arguments: '{"path":"AGENTS.md"}',
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "project rules",
          },
          { role: "user", content: [{ type: "input_text", text: "continue" }] },
        ],
        tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
      },
      { reusedSession: false },
    );

    expect(result.prompt).toContain("Follow AGENTS.md and loaded skills.");
    expect(result.prompt).toContain("assistant:\nI will inspect the project.");
    expect(result.prompt).toContain('"name":"read"');
    expect(result.prompt).toContain("tool:\n[call_id=call_1]\nproject rules");
    expect(result.prompt).toContain("user:\ncontinue");
    expect(result.prompt).not.toContain("private summary");
    expect(result.prompt).not.toContain("private chain");
  });

  it("builds a compact recovery prompt with complete tool results", () => {
    const body = {
      system: "very large repeated Pi instructions",
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
    };
    const result = buildToolRecoveryPrompt(
      body,
      [{ role: "tool", content: "full file result: export const value = 1;" }],
      "仔细分析项目",
    );

    expect(result).toContain("Never end with THINK-only");
    expect(result).toContain("Available tools: read");
    expect(result).toContain("[Original user task]\n仔细分析项目");
    expect(result).toContain("full file result: export const value = 1;");
    expect(result).not.toContain("very large repeated Pi instructions");
    expect(result).not.toContain('"parameters"');
  });

  it("keeps a simple request equivalent to the original user text", () => {
    expect(
      buildDeepSeekPrompt(
        { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
        { reusedSession: false },
      ).prompt,
    ).toBe("hello");
  });
});
