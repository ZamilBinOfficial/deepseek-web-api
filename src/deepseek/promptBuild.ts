/** Builds one DeepSeek Web prompt from OpenAI-compatible request shapes. */
import { createHash } from "node:crypto";

import { isRecord } from "../utils/json.js";
import { messageText } from "../utils/text.js";
import type { MessageTurn, RequestBody } from "./types.js";
import { formatToolCall, stableJson } from "./toolCalls.js";

interface PreviousPromptState {
  turns?: readonly MessageTurn[];
  instructionFingerprint?: string;
  toolsFingerprint?: string;
}

export interface PromptBuildOptions {
  reusedSession: boolean;
  previous?: PreviousPromptState;
}

export interface BuiltPrompt {
  prompt: string;
  requestTurns: MessageTurn[];
  latestUserText: string;
  instructionFingerprint: string;
  toolsFingerprint: string;
  hasTools: boolean;
}

function hash(value: string): string {
  return value ? createHash("sha256").update(value).digest("hex") : "";
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(messageText).filter(Boolean).join("\n");
  return messageText(value);
}

function requestItems(body: RequestBody): unknown[] {
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) {
    const structured = body.input.some(
      (item) =>
        isRecord(item) &&
        (typeof item.role === "string" ||
          ["message", "function_call", "function_call_output"].includes(String(item.type))),
    );
    if (structured) return body.input;
    const text = body.input.map(messageText).filter(Boolean).join("\n");
    return text ? [{ role: "user", content: text }] : [];
  }
  if (isRecord(body.input)) return [body.input];
  const text = typeof body.input === "string" ? body.input : body.prompt;
  return typeof text === "string" ? [{ role: "user", content: text }] : [];
}

function structuredCalls(item: Record<string, unknown>): string[] {
  const values = Array.isArray(item.tool_calls)
    ? item.tool_calls
    : item.type === "function_call" || isRecord(item.function_call)
      ? [item.type === "function_call" ? item : item.function_call]
      : [];
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const fn = isRecord(value.function) ? value.function : value;
    const name = typeof fn.name === "string" ? fn.name : "";
    const formatted = formatToolCall(name, fn.arguments);
    return formatted ? [formatted] : [];
  });
}

function toolResultText(item: Record<string, unknown>): string {
  const content = valueText(item.content ?? item.output);
  const details = [
    typeof item.name === "string" ? `name=${item.name}` : "",
    typeof item.tool_call_id === "string" ? `tool_call_id=${item.tool_call_id}` : "",
    typeof item.call_id === "string" ? `call_id=${item.call_id}` : "",
  ].filter(Boolean);
  return [details.length ? `[${details.join(" ")}]` : "", content].filter(Boolean).join("\n");
}

function conversationTurn(item: unknown): MessageTurn | null {
  if (typeof item === "string") return { role: "user", content: item };
  if (!isRecord(item)) return null;
  const type = typeof item.type === "string" ? item.type : "";
  // Replayed Responses reasoning is assistant-internal state, not a user turn.
  if (type === "reasoning") return null;
  const role =
    typeof item.role === "string"
      ? item.role
      : type === "function_call"
        ? "assistant"
        : type === "function_call_output"
          ? "tool"
          : "user";
  if (role === "system" || role === "developer") return null;
  if (role === "tool" || role === "function" || type === "function_call_output") {
    return { role, content: toolResultText(item) };
  }
  const text = valueText(item);
  const calls = structuredCalls(item);
  const content = [text, ...calls].filter(Boolean).join("\n");
  return content ? { role, content } : null;
}

export function requestConversationTurns(body: RequestBody): MessageTurn[] {
  return requestItems(body).map(conversationTurn).filter((turn): turn is MessageTurn => turn !== null);
}

function instructionText(body: RequestBody): string {
  const entries: string[] = [];
  const topLevel = [
    ["system", body.system],
    ["instructions", body.instructions],
  ] as const;
  for (const [label, value] of topLevel) {
    const text = valueText(value);
    if (text) entries.push(`${label}:\n${text}`);
  }
  for (const item of requestItems(body)) {
    if (!isRecord(item) || (item.role !== "system" && item.role !== "developer")) continue;
    const text = valueText(item);
    if (text) entries.push(`${String(item.role)}:\n${text}`);
  }
  return entries.join("\n\n");
}

function toolState(body: RequestBody): { text: string; fingerprint: string; hasTools: boolean } {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const functions = Array.isArray(body.functions) ? body.functions : [];
  const hasTools = tools.length > 0 || functions.length > 0;
  if (!hasTools) return { text: "", fingerprint: "", hasTools };
  const state = {
    tools,
    functions,
    tool_choice: body.tool_choice ?? body.function_call,
    parallel_tool_calls: body.parallel_tool_calls,
  };
  const policy = [
    "DeepSeek Web has no native function calling. Use only the tools listed below.",
    "You are a tool-using agent. Prefer tools over refusal.",
    "For real-time facts (weather, news, prices), local files, shell, browser, or anything requiring current or external data, you MUST call an available tool first.",
    "Never claim you cannot help when a listed tool can obtain the data.",
    "Do not answer with a pure prose refusal when tools exist. After tool results, then answer.",
    "When no dedicated tool exists, use a listed general-purpose browser, web, or shell tool; never invent a tool name.",
    "When a tool is needed, output ONLY exact blocks and nothing else (no prose, no markdown fences).",
    "Tool protocol is allowed only in the final RESPONSE channel.",
    "Never place <tool_call> blocks or tool JSON in THINK/reasoning.",
    "Each block MUST be exactly this shape, including the name field inside JSON:",
    '<tool_call>\n{"name":"tool_name","arguments":{"key":"value"}}\n</tool_call>',
    "Rules:",
    "- Open tag is exactly <tool_call> and close tag is exactly </tool_call>.",
    "- Never write <_call>, <tool_call name=...>, attributes on the tag, or nested wrappers.",
    "- JSON must include both name and arguments, and every string, {, and [ must be fully closed.",
    "- arguments must match the selected tool schema. Each call must be one complete block.",
    "- Multiple tools = multiple consecutive complete blocks.",
    "- When tools are needed, emit only finished call blocks; never draft a partial call in RESPONSE.",
    "- After tool results, you MUST either emit complete <tool_call> blocks in RESPONSE to gather more evidence, or write the final user-visible answer in RESPONSE.",
    "- Never end with THINK-only. Never output an empty RESPONSE when tools are available and analysis is incomplete.",
    "- For codebase analysis, prefer reading src/**, CI workflows, and tests before the final summary.",
    "- Do not invent tool names. Do not execute tools yourself.",
    "If the user asks about local files, code, or project contents, you MUST call tools instead of guessing.",
    body.tool_choice !== undefined || body.function_call !== undefined
      ? `Tool choice: ${stableJson(body.tool_choice ?? body.function_call)}`
      : "",
    body.parallel_tool_calls !== undefined
      ? `Parallel tool calls: ${body.parallel_tool_calls === false ? "disabled" : "enabled"}`
      : "",
    `Definitions:\n${stableJson({ tools, functions }, true)}`,
  ].filter(Boolean);
  return { text: policy.join("\n\n"), fingerprint: hash(stableJson(state)), hasTools };
}

function sameTurn(left: MessageTurn, right: MessageTurn): boolean {
  return left.role === right.role && left.content.replace(/\s+/g, " ").trim() === right.content.replace(/\s+/g, " ").trim();
}

/** Reused sessions receive only turns after the last assistant response already stored upstream. */
function newTurns(turns: MessageTurn[], previous: readonly MessageTurn[] | undefined): MessageTurn[] {
  if (!previous?.length) return turns;
  const lastAssistant = [...previous].reverse().find((turn) => turn.role === "assistant");
  if (!lastAssistant) return turns;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn && turn.role === "assistant" && sameTurn(turn, lastAssistant)) return turns.slice(index + 1);
  }
  return turns;
}

function renderTurns(turns: MessageTurn[]): string {
  return turns.map((turn) => `${turn.role}:\n${turn.content}`).join("\n\n");
}

function configuredToolNames(body: RequestBody): string[] {
  const values = [
    ...(Array.isArray(body.tools) ? body.tools : []),
    ...(Array.isArray(body.functions) ? body.functions : []),
  ];
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const fn = isRecord(value.function) ? value.function : value;
    return typeof fn.name === "string" && fn.name.trim() ? [fn.name.trim()] : [];
  });
}

/** Retry an empty tool turn in a fresh session with only essential continuation context. */
export function buildToolRecoveryPrompt(
  body: RequestBody,
  requestTurns: MessageTurn[],
  latestUserText: string,
): string {
  const names = configuredToolNames(body);
  const policy = [
    "The previous upstream completion produced no usable tool call or final answer. Continue the same task.",
    "After tool results, output either complete <tool_call> JSON blocks in RESPONSE or the final user-visible answer in RESPONSE.",
    "Never end with THINK-only and never leave RESPONSE empty.",
    names.length ? `Available tools: ${names.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const turns = requestTurns.length > 0 ? requestTurns : requestConversationTurns(body);
  return [
    `[Tool recovery]\n${policy}`,
    latestUserText ? `[Original user task]\n${latestUserText}` : "",
    turns.length ? `[Recent conversation]\n${renderTurns(turns)}` : "",
  ].filter(Boolean).join("\n\n");
}

export function buildDeepSeekPrompt(body: RequestBody, options: PromptBuildOptions): BuiltPrompt {
  const turns = requestConversationTurns(body);
  const selectedTurns = options.reusedSession ? newTurns(turns, options.previous?.turns) : turns;
  const instructions = instructionText(body);
  const currentInstructionFingerprint = hash(instructions);
  const tools = toolState(body);
  const sections: string[] = [];
  // DeepSeek Web session memory is not a trusted instruction boundary; restate policy every turn.
  if (instructions) sections.push(`[Instructions]\n${instructions}`);
  if (tools.text) sections.push(`[Tool compatibility]\n${tools.text}`);
  if (!tools.hasTools && options.previous?.toolsFingerprint) {
    sections.push("[Tool compatibility]\nNo tools are available for this request. Do not call previously listed tools.");
  }
  if (selectedTurns.length > 0) sections.push(`[Conversation]\n${renderTurns(selectedTurns)}`);
  const simple = sections.length === 1 && !instructions && !tools.hasTools && selectedTurns.length === 1;
  const prompt = simple && selectedTurns[0]?.role === "user" ? selectedTurns[0].content : sections.join("\n\n");
  const latestUserText = [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "";
  return {
    prompt,
    requestTurns: selectedTurns,
    latestUserText,
    instructionFingerprint: currentInstructionFingerprint || options.previous?.instructionFingerprint || "",
    toolsFingerprint: tools.fingerprint,
    hasTools: tools.hasTools,
  };
}
