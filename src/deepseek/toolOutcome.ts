/** Normalizes tool-compatible upstream text without exposing protocol garbage. */
import type { ParsedToolCalls } from "./toolCalls.js";
import { parseToolCalls, parseToolCallsFromParts } from "./toolCalls.js";

export const EMPTY_TOOL_RESPONSE_TEXT =
  "DeepSeek Web did not produce a usable tool call or final answer after one automatic retry. Please retry this turn.";

export interface ToolTurnOutcome {
  parsed: ParsedToolCalls;
  reasoningText: string;
  outputText: string;
  promotedReasoning: boolean;
  recoverableEmpty: boolean;
  emptyUpstream: boolean;
}

/** Promote reasoning-only prose, preserve tool calls, and identify responses that need one retry. */
export function resolveToolTurn(
  outputText: string,
  reasoningText: string,
  idSeed: string,
  emptyFallback = "",
): ToolTurnOutcome {
  const parsed = parseToolCallsFromParts(outputText, reasoningText, idSeed);
  let content = parsed.content;
  let promotedReasoning = false;

  if (parsed.toolCalls.length === 0 && !outputText.trim()) {
    const cleanedReasoning = parseToolCalls(reasoningText).content;
    if (cleanedReasoning) {
      content = cleanedReasoning;
      promotedReasoning = true;
    }
  }

  const recoverableEmpty = parsed.toolCalls.length === 0 && !content.trim();
  if (recoverableEmpty && emptyFallback) content = emptyFallback;

  return {
    parsed: { content, toolCalls: parsed.toolCalls },
    reasoningText,
    outputText,
    promotedReasoning,
    recoverableEmpty,
    emptyUpstream: !outputText.trim() && !reasoningText.trim(),
  };
}
