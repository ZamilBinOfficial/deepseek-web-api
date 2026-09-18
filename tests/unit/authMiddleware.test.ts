/** Verifies the documented behavior of the corresponding production module. */
import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";

import {
  apiKeysEqual,
  extractApiKey,
  isApiKeyAuthorized,
  parseApiKeys,
} from "../../src/server/authMiddleware.js";

describe("api key middleware", () => {
  it("extracts Bearer authorization", () => {
    const headers: IncomingHttpHeaders = { authorization: "Bearer sk-test" };
    expect(extractApiKey(headers)).toBe("sk-test");
  });

  it("supports x-api-key and gives it precedence", () => {
    const headers: IncomingHttpHeaders = {
      authorization: "Bearer ignored",
      "x-api-key": "sk-header",
    };
    expect(extractApiKey(headers)).toBe("sk-header");
  });

  it("authorizes supported headers and multiple keys", () => {
    expect(isApiKeyAuthorized({ authorization: "Bearer correct" }, "correct")).toBe(true);
    expect(isApiKeyAuthorized({ "x-api-key": "wrong" }, "correct")).toBe(false);
    expect(isApiKeyAuthorized({ "x-api-key": "b" }, ["a", "b"])).toBe(true);
  });

  it("parses env and file key lists", () => {
    expect(parseApiKeys("a, b\nc", "env")).toEqual(["a", "b", "c"]);
    expect(parseApiKeys("a\n# skip\nb\n", "file")).toEqual(["a", "b"]);
  });

  it("compares keys safely", () => {
    expect(apiKeysEqual("same", "same")).toBe(true);
    expect(apiKeysEqual("wrong", "right")).toBe(false);
    expect(apiKeysEqual("short", "much-longer")).toBe(false);
  });
});
