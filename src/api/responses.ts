/** HTTP adapter for OpenAI Responses, including named SSE event framing. */
import type { ServerResponse } from "node:http";

import type { DeepSeekClient } from "../deepseek/client.js";
import type { RequestBody } from "../deepseek/types.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import { writeJson, writeSse, writeSseHeaders } from "../utils/http.js";

export function responsesErrorEvent(error: unknown): Record<string, unknown> {
  return {
    type: "error",
    code: "deepseek_web_error",
    message: errorMessage(error),
    param: null,
  };
}

/** Stream when requested; otherwise return the fully accumulated response object. */
export async function handleResponses(
  response: ServerResponse,
  body: RequestBody,
  client: DeepSeekClient,
): Promise<void> {
  if (body.stream === true) {
    writeSseHeaders(response);
    try {
      await client.completeResponses(body, (event, data) => writeSse(response, event, data));
      response.write("data: [DONE]\n\n");
      response.end();
    } catch (error) {
      writeSse(response, "error", responsesErrorEvent(error));
      response.end();
    }
    return;
  }

  try {
    const result = await client.completeResponses(body);
    writeJson(response, 200, result.response);
  } catch (error) {
    writeJson(response, errorStatus(error), { error: { message: errorMessage(error) } });
  }
}
