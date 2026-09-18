/** Verifies the documented behavior of the corresponding production module. */
import { describe, expect, it } from "vitest";

import { extractInputText } from "../../src/utils/text.js";

describe("extractInputText", () => {
  it("extracts a plain Responses input", () => {
    expect(extractInputText({ input: "hello" })).toBe("hello");
  });

  it("sends only the latest user prompt from full history", () => {
    expect(
      extractInputText({
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer" },
          { role: "user", content: [{ type: "text", text: "latest" }] },
        ],
      }),
    ).toBe("latest");
  });

  it("joins non-message input content", () => {
    expect(extractInputText({ input: [{ text: "one" }, { content: "two" }] })).toBe("one\ntwo");
  });
});
