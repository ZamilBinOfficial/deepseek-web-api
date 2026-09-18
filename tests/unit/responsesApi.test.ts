/** Verifies OpenAI-compatible Responses transport helpers. */
import { describe, expect, it } from "vitest";

import { responsesErrorEvent } from "../../src/api/responses.js";

describe("Responses API transport", () => {
  it("uses the standard top-level streaming error fields", () => {
    expect(responsesErrorEvent(new Error("upstream failed"))).toEqual({
      type: "error",
      code: "deepseek_web_error",
      message: "upstream failed",
      param: null,
    });
  });
});
