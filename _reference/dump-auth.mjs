import { chromium } from "playwright-core";
import fs from "fs";

const CDP = process.env.DS_CDP || "http://127.0.0.1:9333";
const OUT = process.env.DS_AUTH_FILE || new URL("./auth.json", import.meta.url).pathname;

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page =
  ctx.pages().find((p) => p.url().includes("chat.deepseek.com")) ||
  (await ctx.newPage());
if (!page.url().includes("chat.deepseek.com")) {
  await page.goto("https://chat.deepseek.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
}

const token = await page.evaluate(() => {
  const raw = localStorage.getItem("userToken");
  if (!raw) return null;
  try {
    return JSON.parse(raw).value;
  } catch {
    return raw;
  }
});
if (!token) throw new Error("no userToken in localStorage — login first");

const cookies = await ctx.cookies(["https://chat.deepseek.com"]);
const auth = {
  token,
  cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  cookies,
  dumped_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(auth, null, 2));
console.log("wrote", OUT, "token_len", token.length, "cookies", cookies.length);
process.exit(0);
