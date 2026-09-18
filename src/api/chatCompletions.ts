/** HTTP adapter for OpenAI Chat Completions stream and object formats. */
import type { ServerResponse } from "node:http";

import type { DeepSeekClient } from "../deepseek/client.js";
import type { OpenAIResponse } from "../deepseek/mapResponses.js";
import type { RequestBody } from "../deepseek/types.js";
import { isRecord } from "../utils/json.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import { writeJson, writeSseHeaders } from "../utils/http.js";

function reasoningText(output: Array<Record<string, unknown>>): string | undefined {
  const reasoning = output.find((item) => item.type === "reasoning");
  if (!reasoning || !Array.isArray(reasoning.content)) return undefined;
  const first = reasoning.content[0];
  return isRecord(first) && typeof first.text === "string" ? first.text : undefined;
}

function chatToolCalls(output: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return output.flatMap((item) => {
    if (
      item.type !== "function_call" ||
      typeof item.call_id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.arguments !== "string"
    ) {
      return [];
    }
    return [{
      id: item.call_id,
      type: "function",
      function: { name: item.name, arguments: item.arguments },
    }];
  });
}

export function responseChatChoice(result: OpenAIResponse) {
  const reasoning = reasoningText(result.output);
  const toolCalls = chatToolCalls(result.output);
  return {
    index: 0,
    message: {
      role: "assistant",
      content: toolCalls.length > 0 ? result.output_text || null : result.output_text || "",
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
  };
}

/** Preserve reasoning_content as a separate field in both response modes. */
export async function handleChatCompletions(
  response: ServerResponse,
  body: RequestBody,
  client: DeepSeekClient,
): Promise<void> {
  if (body.stream === true) {
    writeSseHeaders(response);
    try {
      await client.streamChat(body, (chunk) => {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });
      response.write("data: [DONE]\n\n");
      response.end();
    } catch (error) {
      response.write(`data: ${JSON.stringify({ error: { message: errorMessage(error) } })}\n\n`);
      response.end();
    }
    return;
  }

  try {
    const { response: result } = await client.completeResponses(body);
    writeJson(response, 200, {
      id: `chatcmpl_${result.metadata.chat_session_id}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [responseChatChoice(result)],
      usage: {
        prompt_tokens: 0,
        completion_tokens: result.usage.total_tokens,
        total_tokens: result.usage.total_tokens,
      },
      conversation: result.metadata.chat_session_id,
      previous_response_id: result.id,
    });
  } catch (error) {
    writeJson(response, errorStatus(error), { error: { message: errorMessage(error) } });
  }
}
