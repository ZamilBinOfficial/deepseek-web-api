/** Enforces the hard limit of 300 physical lines for every TypeScript source file. */
import fs from "node:fs";
import path from "node:path";

function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(target);
    return entry.isFile() && target.endsWith(".ts") ? [target] : [];
  });
}

const failures = collect("src")
  .map((file) => ({ file, lines: fs.readFileSync(file, "utf8").split("\n").length - 1 }))
  .filter(({ lines }) => lines > 300);

if (failures.length > 0) {
  for (const failure of failures) console.error(`${failure.lines} ${failure.file}`);
  process.exit(1);
}
console.log("Source line limit check passed");
