// Talk to the running backend from the terminal, the same way a caller would (minus the voice).
// Usage: npm run chat            (English)
//        npm run chat -- hi      (Hindi; also te, ta, kn)

import "dotenv/config";
import readline from "node:readline/promises";

const base = `http://localhost:${process.env.PORT || 3000}`;
const langCode = process.argv[2] || "en";
const headers = { "content-type": "application/json" };
if (process.env.API_TOKEN) headers["x-api-token"] = process.env.API_TOKEN;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Chatting with ${base} in "${langCode}". Type a command, or "exit".`);
for (;;) {
  const text = (await rl.question("you> ")).trim();
  if (!text || text === "exit") break;
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers, body: JSON.stringify({ text, lang: langCode, session: "cli" }) });
  const body = await res.json();
  console.log(`bot> ${body.reply ?? body.error}${body.hangup ? "  [call would hang up]" : ""}`);
}
rl.close();
