/** Extracts text from OpenAI-style message shapes without trusting request input. */
import { isRecord } from "./json.js";

function contentPartText(part: unknown): string {
  if (!isRecord(part)) return "";
  const value = part.text ?? part.input_text ?? part.output_text;
  return typeof value === "string" ? value : "";
}

export function messageText(message: unknown): string {
  if (message === null || message === undefined) return "";
  if (typeof message === "string") return message;
  if (!isRecord(message)) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map(contentPartText).filter(Boolean).join("\n");
  }
  if (typeof message.text === "string") return message.text;
  return "";
}

/** Return only the newest user turn because DeepSeek stores prior turns server-side. */
export function latestUserText(items: unknown[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (typeof item === "string") return item;
    if (!isRecord(item)) continue;
    const role = typeof item.role === "string" ? item.role : "user";
    if (role === "user") return messageText(item);
  }
  return messageText(items.at(-1));
}

/** Normalize Responses, Chat Completions, and prompt-style input into one prompt. */
export function extractInputText(body: Record<string, unknown>): string {
  if (typeof body.input === "string") return body.input;
  if (Array.isArray(body.input)) {
    const containsMessages = body.input.some(
      (item) => isRecord(item) && (typeof item.role === "string" || item.type === "message"),
    );
    if (containsMessages) return latestUserText(body.input);
    return body.input.map(messageText).filter(Boolean).join("\n");
  }
  if (Array.isArray(body.messages)) return latestUserText(body.messages);
  return typeof body.prompt === "string" ? body.prompt : "";
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
