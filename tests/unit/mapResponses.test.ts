/** Verifies final Responses tool-call compatibility mapping. */
import { describe, expect, it } from "vitest";

import { consumeResponses } from "../../src/deepseek/mapResponses.js";
import { EMPTY_TOOL_RESPONSE_TEXT } from "../../src/deepseek/toolOutcome.js";

interface EventRecord {
  event: string;
  data: Record<string, unknown>;
}

function upstream(parts: { reasoning?: string; output?: string; responseMessageId?: number }): Response {
  const fragments = [
    ...(parts.reasoning ? [{ type: "THINK", content: parts.reasoning }] : []),
    ...(parts.output ? [{ type: "RESPONSE", content: parts.output }] : []),
  ];
  return new Response(
    `event: ready\ndata: {"response_message_id":${parts.responseMessageId ?? 7}}\n\n` +
      `data: {"p":"response/fragments","o":"APPEND","v":${JSON.stringify(fragments)}}\n\n`,
  );
}

function baseInput(stream: Response): Parameters<typeof consumeResponses>[0] {
  return {
    upstream: stream,
    publicModel: "deepseek-v4-flash",
    modelType: "default",
    sessionId: "session-1",
    thinkingEnabled: true,
    searchEnabled: false,
    toolCompatibilityEnabled: true,
    toolReasoning: "hidden",
  };
}

describe("consumeResponses", () => {
  it("maps a tool-only output without reasoning or an empty message by default", async () => {
    const tagged = '<tool_call>\n{"name":"get_weather","arguments":{"city":"Hefei"}}\n</tool_call>';
    const events: EventRecord[] = [];
    const result = await consumeResponses({
      ...baseInput(upstream({ output: tagged })),
      emit: (event, data) => events.push({ event, data }),
    });

    expect(result.response.output_text).toBe("");
    expect(result.response.output.map((item) => item.type)).toEqual(["function_call"]);
    expect(result.response.output[0]).toMatchObject({
      type: "function_call",
      name: "get_weather",
      arguments: '{"city":"Hefei"}',
    });
    expect(result.rawOutputText).toBe(
      '<tool_call>\n{"arguments":{"city":"Hefei"},"name":"get_weather"}\n</tool_call>',
    );
    expect(events.filter(({ event }) => event.includes("reasoning"))).toEqual([]);
    expect(events.filter(({ event }) => event === "response.output_text.delta")).toEqual([]);
  });

  it("maps a repaired truncated tool payload to a Responses function_call", async () => {
    const truncated = '<_call>\n{"name":"read","arguments":{"path":"package.json"}\n</tool_call>';
    const result = await consumeResponses(baseInput(upstream({ output: truncated })));

    expect(result.response.output_text).toBe("");
    expect(result.response.output).toContainEqual(
      expect.objectContaining({
        type: "function_call",
        name: "read",
        arguments: '{"path":"package.json"}',
      }),
    );
    expect(result.rawOutputText).toBe(
      '<tool_call>\n{"arguments":{"path":"package.json"},"name":"read"}\n</tool_call>',
    );
  });

  it("does not expose unrepaired protocol-only garbage as final output text", async () => {
    const garbage = '<_call>\n{"name":"read","arguments":{"path":"package.json}\n</tool_call>';
    const result = await consumeResponses(baseInput(upstream({ output: garbage })));

    expect(result.response.output_text).toBe(EMPTY_TOOL_RESPONSE_TEXT);
    expect(JSON.stringify(result.response.output)).not.toContain("<_call>");
    expect(JSON.stringify(result.response.output)).not.toContain('{"name":"read"');
    expect(result.rawOutputText).toBe(EMPTY_TOOL_RESPONSE_TEXT);
    expect(result.diagnostics.recoverableEmpty).toBe(true);
  });

  it("does not promote unrepaired reasoning-only protocol garbage to final text", async () => {
    const garbage = '<_call>\n{"name":"read","arguments":{"path":"package.json}\n</tool_call>';
    const result = await consumeResponses(baseInput(upstream({ reasoning: garbage })));

    expect(result.response.output_text).toBe(EMPTY_TOOL_RESPONSE_TEXT);
    expect(JSON.stringify(result.response.output)).not.toContain("<_call>");
    expect(result.rawOutputText).toBe(EMPTY_TOOL_RESPONSE_TEXT);
    expect(result.diagnostics.recoverableEmpty).toBe(true);
  });

  it("never maps a double-empty tool response to an empty completed message", async () => {
    const result = await consumeResponses(baseInput(upstream({})));

    expect(result.response.output_text).toBe(EMPTY_TOOL_RESPONSE_TEXT);
    expect(result.response.output).toContainEqual(expect.objectContaining({
      type: "message",
      content: [{ type: "output_text", text: EMPTY_TOOL_RESPONSE_TEXT }],
    }));
    expect(result.diagnostics).toMatchObject({
      emptyUpstream: true,
      recoverableEmpty: true,
      toolCallCount: 0,
    });
  });

  it("hides reasoning prose and leaked tool protocol on a tool turn", async () => {
    const reasoning =
      'I should fetch it.\n<tool_call>\n{"name":"bash","arguments":{"command":"date"}}\n</tool_call>';
    const result = await consumeResponses(baseInput(upstream({ reasoning })));

    expect(result.response.output.map((item) => item.type)).toEqual(["function_call"]);
    expect(result.response.output[0]).toMatchObject({ name: "bash", arguments: '{"command":"date"}' });
    expect(JSON.stringify(result.response.output)).not.toContain("I should fetch it");
    expect(JSON.stringify(result.response.output)).not.toContain("<tool_call>");
  });

  it("emits only cleaned reasoning in clean mode", async () => {
    const reasoning =
      'Need current data.\n<tool_call>\n{"name":"bash","arguments":{"command":"date"}}\n</tool_call>';
    const output = '<tool_call>\n{"name":"bash","arguments":{"command":"date"}}\n</tool_call>';
    const result = await consumeResponses({
      ...baseInput(upstream({ reasoning, output })),
      toolReasoning: "clean",
    });

    expect(result.response.output.map((item) => item.type)).toEqual(["reasoning", "function_call"]);
    expect(result.response.output[0]).toMatchObject({
      type: "reasoning",
      content: [{ type: "reasoning_text", text: "Need current data." }],
    });
    expect(JSON.stringify(result.response.output[0])).not.toContain("<tool_call>");
    expect(JSON.stringify(result.response.output[0])).not.toContain('"name":"bash"');
  });

  it("keeps genuine cleaned RESPONSE prose before function calls", async () => {
    const output =
      'I will inspect the file.\n<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>';
    const result = await consumeResponses(baseInput(upstream({ output })));

    expect(result.response.output.map((item) => item.type)).toEqual(["message", "function_call"]);
    expect(result.response.output_text).toBe("I will inspect the file.");
    expect(result.response.output[0]).toMatchObject({
      content: [{ type: "output_text", text: "I will inspect the file." }],
    });
  });

  it("emits standard function argument SSE events in terminal order", async () => {
    const tagged = '<tool_call>\n{"name":"read","arguments":{"path":"README.md"}}\n</tool_call>';
    const events: EventRecord[] = [];
    await consumeResponses({
      ...baseInput(upstream({ output: tagged })),
      emit: (event, data) => events.push({ event, data }),
    });

    expect(events).toContainEqual({
      event: "response.output_item.added",
      data: expect.objectContaining({
        output_index: 0,
        item: expect.objectContaining({ type: "function_call", arguments: "", status: "in_progress" }),
      }),
    });
    expect(events).toContainEqual({
      event: "response.function_call_arguments.delta",
      data: expect.objectContaining({ output_index: 0, delta: '{"path":"README.md"}' }),
    });
    expect(events).toContainEqual({
      event: "response.function_call_arguments.done",
      data: expect.objectContaining({ output_index: 0, arguments: '{"path":"README.md"}' }),
    });
    expect(events).toContainEqual({
      event: "response.output_item.done",
      data: expect.objectContaining({ output_index: 0, item: expect.objectContaining({ status: "completed" }) }),
    });
  });

  it("promotes a reasoning-only final answer into one message without duplication", async () => {
    const answer = "抱歉我无法获取实时天气数据。";
    const events: EventRecord[] = [];
    const result = await consumeResponses({
      ...baseInput(upstream({ reasoning: answer })),
      emit: (event, data) => events.push({ event, data }),
    });

    expect(result.response.output_text).toBe(answer);
    expect(result.response.output).toEqual([
      expect.objectContaining({
        type: "message",
        content: [{ type: "output_text", text: answer }],
      }),
    ]);
    expect(events.filter(({ event }) => event.includes("reasoning"))).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      event: "response.output_text.delta",
      data: expect.objectContaining({ delta: answer, output_index: 0 }),
    }));
    expect(result.rawOutputText).toBe(answer);
    expect(result.diagnostics).toMatchObject({
      promotedReasoning: true,
      recoverableEmpty: false,
    });
  });

  it("streams reasoning once before a normal message", async () => {
    const events: EventRecord[] = [];
    const result = await consumeResponses({
      ...baseInput(upstream({ reasoning: "Check facts.", output: "Final answer." })),
      toolCompatibilityEnabled: false,
      emit: (event, data) => events.push({ event, data }),
    });

    expect(result.response.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(result.response.output_text).toBe("Final answer.");
    expect(
      events
        .filter(({ event }) => event.endsWith(".delta") && event.includes("reasoning"))
        .map(({ event }) => event),
    ).toEqual(["response.reasoning_text.delta"]);
  });

  it("keeps multiple function calls ordered with continuous output indexes", async () => {
    const output = [
      '<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>',
      '<tool_call>{"arguments":{"command":"pwd"},"name":"bash"}</tool_call>',
    ].join("\n");
    const events: EventRecord[] = [];
    const result = await consumeResponses({
      ...baseInput(upstream({ output })),
      emit: (event, data) => events.push({ event, data }),
    });

    expect(result.response.output.map((item) => item.name)).toEqual(["read", "bash"]);
    const added = events.filter(({ event, data }) =>
      event === "response.output_item.added" &&
      typeof data.item === "object" &&
      data.item !== null &&
      "type" in data.item &&
      data.item.type === "function_call",
    );
    expect(added.map(({ data }) => data.output_index)).toEqual([0, 1]);
  });
});
