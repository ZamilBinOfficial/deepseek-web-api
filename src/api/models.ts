/** Serves the stable public model list exposed by this compatibility layer. */
import type { ServerResponse } from "node:http";

import { writeJson } from "../utils/http.js";

export function handleModels(response: ServerResponse): void {
  writeJson(response, 200, {
    object: "list",
    data: [
      { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek-web" },
      { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek-web" },
    ],
  });
}
