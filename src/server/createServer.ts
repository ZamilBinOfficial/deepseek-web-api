/** Creates the Node HTTP server and centralizes asynchronous route error handling. */
import http, { type Server } from "node:http";

import { handleRouteError, routeRequest } from "./routes.js";
import type { ServerDependencies } from "./types.js";

/** Build an unbound server so tests and the CLI can choose the listen address. */
export function createServer(dependencies: ServerDependencies): Server {
  return http.createServer((request, response) => {
    void routeRequest(request, response, dependencies).catch((error: unknown) => {
      handleRouteError(response, error, dependencies.debug);
    });
  });
}
