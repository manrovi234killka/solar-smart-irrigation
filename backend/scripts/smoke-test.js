// End-to-end check of the call flow without a phone, a broker or an API key:
// starts the server with the simulated ESP32 and the keyword agent, then plays a call through the Twilio webhooks.
// Usage: npm test            (add AI_MODE=claude in the environment to exercise Claude instead)

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3999;
const base = `http://localhost:${PORT}`;
const useClaude = process.env.AI_MODE === "claude";

const server = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    SIMULATOR: "true",
    AI_MODE: useClaude ? "claude" : "rules",
    TWILIO_AUTH_TOKEN: "",
    API_TOKEN: "",
    ALLOWED_CALLERS: "",
    CALLERS_FILE: path.join(os.tmpdir(), `callers-smoke-${Date.now()}.json`),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const call = { CallSid: "CAsmoke", From: "+10000000000" };
async function twilioPost(route, fields) {
  const res = await fetch(base + route, { method: "POST", body: new URLSearchParams({ ...call, ...fields }) });
  return res.text();
}
const status = async () => (await fetch(`${base}/api/status`)).json();

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
  if (!ok) failures++;
}

try {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/api/status`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  let xml = await twilioPost("/voice/incoming", {});
  check("new caller hears the language menu", xml.includes("<Gather") && xml.includes("press 1") && xml.includes("తెలుగు"), xml);

  xml = await twilioPost("/voice/language", { Digits: "1" });
  check("pressing 1 picks English and greets", xml.includes("farm assistant") && xml.includes('language="en-IN"'), xml);

  xml = await twilioPost("/voice/respond?lang=en", { SpeechResult: "run the pump for 10 minutes", Confidence: "0.9" });
  let s = await status();
  check("timed run starts the pump", s.pump === true && s.run_remaining_s > 500, JSON.stringify(s));
  check("reply mentions the duration", /10|ten/i.test(xml), xml);

  xml = await twilioPost("/voice/respond?lang=en", { SpeechResult: "turn the pump off" });
  s = await status();
  check("pump turns off", s.pump === false, JSON.stringify(s));

  xml = await twilioPost("/voice/respond?lang=en", { SpeechResult: "what is the soil moisture" });
  check("status question gets moisture in the reply", /percent|%/i.test(xml), xml);

  xml = await twilioPost("/voice/respond?lang=en", { SpeechResult: "" });
  check("silence asks the caller to repeat", xml.includes("did not hear"), xml);

  xml = await twilioPost("/voice/respond?lang=en", { Digits: "2" });
  check("pressing 2 mid-call switches to Hindi", xml.includes('language="hi-IN"') && xml.includes("नमस्ते"), xml);

  xml = await twilioPost("/voice/incoming", {});
  check("returning caller skips the menu in their language", xml.includes("नमस्ते") && !xml.includes("press 1"), xml);

  xml = await twilioPost("/voice/respond?lang=en", { SpeechResult: "thank you, bye" });
  check("goodbye hangs up", xml.includes("<Hangup"), xml);
} catch (err) {
  failures++;
  console.error("Test crashed:", err);
} finally {
  server.kill();
}

if (failures) {
  console.log(`\n${failures} check(s) failed. Server log:\n${serverLog}`);
  process.exit(1);
}
console.log(`\nAll checks passed (${useClaude ? "Claude" : "keyword"} agent, simulated ESP32).`);
