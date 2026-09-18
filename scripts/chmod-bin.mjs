/** Restores executable mode on the compiled CLI entry after TypeScript emit. */
import fs from "node:fs";

fs.chmodSync(new URL("../dist/index.js", import.meta.url), 0o755);
