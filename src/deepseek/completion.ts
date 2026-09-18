/** Opens the Node-side streaming completion request using browser-derived auth and PoW. */
import { CLIENT_HEADERS, COMPLETION_PATH } from "../config/constants.js";
import type { DeepSeekAuth, ModelType } from "./types.js";
import type { MessageId } from "./sessionStore.js";

export interface CompletionRequest {
  token: string;
  powHeader: string;
  sessionId: string;
  modelType: ModelType;
  prompt: string;
  thinking: boolean;
  search: boolean;
  parentMessageId: MessageId;
}

/** Send the compatibility prompt and stored parent message ID to preserve lineage. */
export async function openCompletionStream(
  baseUrl: string,
  auth: DeepSeekAuth,
  input: CompletionRequest,
): Promise<Response> {
  const headers = new Headers({
    authorization: `Bearer ${input.token}`,
    "content-type": "application/json",
    accept: "text/event-stream",
    "x-ds-pow-response": input.powHeader,
    ...CLIENT_HEADERS,
    origin: baseUrl,
    referer: `${baseUrl}/a/chat/s/${input.sessionId}`,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36",
  });
  // Cookies are refreshed from Chrome before each request to follow token rotation.
  if (auth.cookie) headers.set("cookie", auth.cookie);
  return fetch(`${baseUrl}${COMPLETION_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chat_session_id: input.sessionId,
      parent_message_id: input.parentMessageId,
      model_type: input.modelType,
      prompt: input.prompt,
      ref_file_ids: [],
      thinking_enabled: input.thinking,
      search_enabled: input.search,
      action: null,
      preempt: false,
    }),
  });
}
