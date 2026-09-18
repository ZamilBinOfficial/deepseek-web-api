/** Verifies the packaged CLI contract without starting Chrome or the HTTP server. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function runCli(argument: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", argument], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("CLI", () => {
  it("prints help without initializing the browser runtime", () => {
    const result = runCli("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deepseek-web-api login");
    expect(result.stderr).toBe("");
  });

  it("reads the version from package.json", () => {
    const result = runCli("--version");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
    expect(result.stderr).toBe("");
  });
});
