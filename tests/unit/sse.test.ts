/** Verifies the documented behavior of the corresponding production module. */
import { describe, expect, it } from "vitest";

import { SseParser, iterDeepSeekSse } from "../../src/deepseek/sse.js";
import { iterDeepSeekUpdates } from "../../src/deepseek/updates.js";

describe("DeepSeek SSE parser", () => {
  it("parses chunk boundaries, event names, and CRLF", () => {
    const parser = new SseParser();
    expect(parser.push('event: ready\r\ndata: {"response_message_id":')).toEqual([]);
    expect(parser.push('42}\r\n\r\ndata: {"v":"hello"}\n\n')).toEqual([
      { event: "ready", data: { response_message_id: 42 } },
      { event: null, data: { v: "hello" } },
    ]);
  });

  it("ignores malformed JSON and parses a final unterminated block", () => {
    const parser = new SseParser();
    parser.push("data: not-json\n\n");
    parser.push('event: title\ndata: {"content":"name"}');
    expect(parser.finish()).toEqual([{ event: "title", data: { content: "name" } }]);
  });

  it("iterates a web Response stream", async () => {
    const response = new Response('event: ready\ndata: {"request_message_id":1}\n\n');
    const events = [];
    for await (const event of iterDeepSeekSse(response)) events.push(event);
    expect(events).toEqual([{ event: "ready", data: { request_message_id: 1 } }]);
  });

  it("keeps reasoning and output deltas separate", async () => {
    const body = [
      'data: {"p":"response/fragments","o":"APPEND","v":[{"type":"THINK","content":"why"}]}\n\n',
      'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"?"}\n\n',
      'data: {"p":"response/fragments","o":"APPEND","v":[{"type":"RESPONSE","content":"answer"}]}\n\n',
      'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"!"}\n\n',
    ].join("");
    const updates = [];
    for await (const update of iterDeepSeekUpdates(new Response(body))) updates.push(update);
    expect(updates).toEqual([
      { type: "reasoning", delta: "why" },
      { type: "reasoning", delta: "?" },
      { type: "output", delta: "answer" },
      { type: "output", delta: "!" },
    ]);
  });
});
