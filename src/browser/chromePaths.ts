/** Locate a system Chrome/Chromium binary without downloading Playwright browsers. */
import fs from "node:fs";
import path from "node:path";

const MAC_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const LINUX_CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function executableOnPath(name: string): string | undefined {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function windowsChromePaths(): string[] {
  return [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter((value): value is string => Boolean(value))
    .map((directory) => path.join(directory, "Google", "Chrome", "Application", "chrome.exe"));
}

export function findChromeExecutable(configured?: string): string {
  const candidates = [
    configured,
    ...MAC_CHROME_PATHS,
    ...LINUX_CHROME_PATHS,
    ...windowsChromePaths(),
    executableOnPath("google-chrome"),
    executableOnPath("chromium"),
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("未找到 Chrome。请安装 Google Chrome，或通过 DS_CHROME_PATH 指定可执行文件。");
  }
  return found;
}
