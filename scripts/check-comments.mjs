/** Enforces the repository rule that source-code comments use English-only ASCII text. */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["src", "tests", "scripts", "vitest.config.ts", "eslint.config.js"];
const extensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

function collect(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return extensions.has(path.extname(target)) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    collect(path.join(target, entry.name)),
  );
}

const failures = [];
for (const file of roots.flatMap(collect)) {
  const source = fs.readFileSync(file, "utf8");
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const isComment =
      token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia;
    if (isComment && /[^\x00-\x7f]/.test(scanner.getTokenText())) {
      const position = scanner.getTokenPos();
      const line = source.slice(0, position).split("\n").length;
      failures.push(`${file}:${line}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Non-English comment text found:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("Comment language check passed");
