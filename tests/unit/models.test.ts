/** Verifies the documented behavior of the corresponding production module. */
import { describe, expect, it } from "vitest";

import { resolveModel, resolveSearch, resolveThinking } from "../../src/deepseek/models.js";

 describe("model resolution", () => {
  it.each([
    ["flash", "default", "deepseek-v4-flash"],
    ["default", "default", "deepseek-v4-flash"],
    ["deepseek-v4-flash", "default", "deepseek-v4-flash"],
    ["pro", "expert", "deepseek-v4-pro"],
    ["expert", "expert", "deepseek-v4-pro"],
    ["deepseek-reasoner", "expert", "deepseek-v4-pro"],
  ])("maps %s", (model, modelType, publicModel) => {
    expect(resolveModel({ model })).toMatchObject({ modelType, publicModel });
  });

  it("maps thinking levels to the web boolean", () => {
    expect(resolveThinking({ reasoning: { effort: "none" } })).toBe(false);
    expect(resolveThinking({ thinking_level: "high" })).toBe(true);
    expect(resolveThinking({ thinking_enabled: false })).toBe(false);
  });

  it("forces search off for expert", () => {
    expect(resolveSearch({ search_enabled: true }, "expert")).toBe(false);
    expect(resolveSearch({ tools: [{ type: "web_search" }] }, "default")).toBe(true);
  });
});
