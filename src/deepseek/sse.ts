/** Parses chunked DeepSeek SSE while preserving event names and JSON payloads. */
import { HttpError } from "../utils/errors.js";
import { isRecord } from "../utils/json.js";
import type { DeepSeekSseEvent } from "./types.js";

/** Stateful parser because network chunks may split an SSE block at any byte. */
export class SseParser {
  private buffer = "";

  push(chunk: string): DeepSeekSseEvent[] {
    this.buffer += chunk;
    const events: DeepSeekSseEvent[] = [];
    while (true) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match || match.index === undefined) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** Flush a valid final block even when the upstream omits the trailing blank line. */
  finish(): DeepSeekSseEvent[] {
    const block = this.buffer;
    this.buffer = "";
    const parsed = parseBlock(block);
    return parsed ? [parsed] : [];
  }
}

function parseBlock(block: string): DeepSeekSseEvent | null {
  if (!block.trim()) return null;
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    return isRecord(parsed) ? { event, data: parsed } : null;
  } catch {
    // Ignore malformed frames instead of corrupting the remaining stream.
    return null;
  }
}

/** Convert a Fetch Response body into validated DeepSeek SSE events. */
export async function* iterDeepSeekSse(response: Response): AsyncGenerator<DeepSeekSseEvent> {
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new HttpError(502, `DeepSeek upstream ${response.status}: ${message}`);
  }
  if (!response.body) throw new HttpError(502, "DeepSeek upstream returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parser.push(decoder.decode(value, { stream: true }))) yield event;
  }
  for (const event of parser.push(decoder.decode())) yield event;
  for (const event of parser.finish()) yield event;
}
