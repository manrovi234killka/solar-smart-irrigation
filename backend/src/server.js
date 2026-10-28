// Twilio voice webhooks + a small test API.
//
// Call flow:
//   /voice/incoming  -> keypad language menu (skipped for callers whose language is remembered)
//   /voice/language  -> save the language, greet, listen for speech
//   /voice/respond   -> speech text -> agent -> spoken reply -> listen again (pressing 1-5 switches language)
//   /voice/result    -> used only when the agent takes longer than one webhook allows
//   /voice/status    -> Twilio call-status callback, clears the call's conversation
//   /sms             -> Twilio Messaging webhook: the same assistant over SMS

import "dotenv/config";
import express from "express";
import twilio from "twilio";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDevice } from "./device.js";
import { createAgent } from "./agent.js";
import { startRainSync } from "./weather.js";
import { LANGUAGES, DEFAULT_LANG, SPEECH_HINTS, lang, langByDigit } from "./languages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const ALLOWED_CALLERS = (process.env.ALLOWED_CALLERS || "").split(",").map((s) => s.trim()).filter(Boolean);
const FIRST_WAIT_MS = 9000; // Twilio gives a webhook 15 s; answer within this or fall back to /voice/result
const RESULT_WAIT_MS = 12000;

const device = createDevice();
const agent = createAgent(device);
startRainSync(device);
const { VoiceResponse, MessagingResponse } = twilio.twiml;

// ---- remembered caller languages (data/callers.json) ----
const callersFile = process.env.CALLERS_FILE || path.join(here, "..", "data", "callers.json");
let callers = {};
try {
  callers = JSON.parse(fs.readFileSync(callersFile, "utf8"));
} catch {}
function saveCallerLang(number, code) {
  if (!number) return;
  callers[number] = code;
  fs.mkdirSync(path.dirname(callersFile), { recursive: true });
  fs.writeFileSync(callersFile, JSON.stringify(callers, null, 2));
}

// ---- per-call state ----
const pending = new Map(); // CallSid -> Promise<{reply, hangup}>
const misses = new Map(); // CallSid -> consecutive turns with no speech

function say(node, code, text) {
  const L = lang(code);
  node.say({ voice: L.voice, language: L.speech }, text);
}

function listen(twiml, code, prompt) {
  const gather = twiml.gather({
    input: "speech dtmf",
    numDigits: 1,
    language: lang(code).speech,
    speechTimeout: "auto",
    hints: SPEECH_HINTS,
    actionOnEmptyResult: true,
    action: `/voice/respond?lang=${code}`,
    method: "POST",
  });
  say(gather, code, prompt);
}

function speakResult(twiml, code, callSid, { reply, hangup }) {
  if (hangup) {
    say(twiml, code, reply);
    twiml.hangup();
    agent.endCall(callSid);
  } else {
    listen(twiml, code, reply);
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Reject requests not signed by Twilio when an auth token is configured.
const validateTwilio =
  process.env.TWILIO_AUTH_TOKEN && process.env.VALIDATE_TWILIO !== "false"
    ? twilio.webhook({
        validate: true,
        ...(PUBLIC_URL ? { protocol: new URL(PUBLIC_URL).protocol.replace(":", ""), host: new URL(PUBLIC_URL).host } : {}),
      })
    : (req, res, next) => next();

const voice = express.Router();
voice.use(validateTwilio);

voice.post("/incoming", (req, res) => {
  const twiml = new VoiceResponse();
  const from = req.body.From;
  console.log(`[call] incoming from ${from} (${req.body.CallSid})`);

  if (ALLOWED_CALLERS.length && !ALLOWED_CALLERS.includes(from)) {
    say(twiml, DEFAULT_LANG, "Sorry, this number is not registered with the farm.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  const known = callers[from];
  if (known && LANGUAGES[known]) {
    listen(twiml, known, lang(known).greeting);
  } else {
    const menu = twiml.gather({ input: "dtmf", numDigits: 1, timeout: 6, action: "/voice/language", method: "POST" });
    for (const code of Object.keys(LANGUAGES)) say(menu, code, lang(code).menu);
    twiml.redirect({ method: "POST" }, `/voice/language?Digits=${lang(DEFAULT_LANG).digit}`);
  }
  res.type("text/xml").send(twiml.toString());
});

voice.post("/language", (req, res) => {
  const digit = req.body.Digits || req.query.Digits;
  const code = langByDigit(digit) || DEFAULT_LANG;
  saveCallerLang(req.body.From, code);
  const twiml = new VoiceResponse();
  listen(twiml, code, lang(code).greeting);
  res.type("text/xml").send(twiml.toString());
});

voice.post("/respond", async (req, res) => {
  const callSid = req.body.CallSid;
  let code = LANGUAGES[req.query.lang] ? req.query.lang : DEFAULT_LANG;
  const twiml = new VoiceResponse();

  // Keypad press during the conversation = switch language.
  const switched = langByDigit(req.body.Digits);
  if (switched) {
    saveCallerLang(req.body.From, switched);
    agent.endCall(callSid);
    listen(twiml, switched, lang(switched).greeting);
    return res.type("text/xml").send(twiml.toString());
  }

  const speech = (req.body.SpeechResult || "").trim();
  if (!speech) {
    const n = (misses.get(callSid) || 0) + 1;
    misses.set(callSid, n);
    if (n >= 3) {
      say(twiml, code, lang(code).goodbye);
      twiml.hangup();
    } else {
      listen(twiml, code, lang(code).notHeard);
    }
    return res.type("text/xml").send(twiml.toString());
  }
  misses.delete(callSid);
  console.log(`[call] ${callSid} (${code}) heard: "${speech}" (confidence ${req.body.Confidence})`);

  const work = agent.handleTurn(callSid, code, speech).catch((err) => {
    console.error("[call] agent error:", err.message);
    return { reply: lang(code).error, hangup: false };
  });
  const result = await withTimeout(work, FIRST_WAIT_MS);
  if (result) {
    console.log(`[call] reply: "${result.reply}"`);
    speakResult(twiml, code, callSid, result);
  } else {
    pending.set(callSid, work);
    say(twiml, code, lang(code).wait);
    twiml.redirect({ method: "POST" }, `/voice/result?lang=${code}&try=1`);
  }
  res.type("text/xml").send(twiml.toString());
});

voice.post("/result", async (req, res) => {
  const callSid = req.body.CallSid;
  const code = LANGUAGES[req.query.lang] ? req.query.lang : DEFAULT_LANG;
  const attempt = Number(req.query.try || 1);
  const twiml = new VoiceResponse();
  const work = pending.get(callSid);
  const result = work ? await withTimeout(work, RESULT_WAIT_MS) : { reply: lang(code).error, hangup: false };

  if (result) {
    pending.delete(callSid);
    console.log(`[call] reply: "${result.reply}"`);
    speakResult(twiml, code, callSid, result);
  } else if (attempt < 3) {
    twiml.pause({ length: 1 });
    twiml.redirect({ method: "POST" }, `/voice/result?lang=${code}&try=${attempt + 1}`);
  } else {
    pending.delete(callSid);
    listen(twiml, code, lang(code).error);
  }
  res.type("text/xml").send(twiml.toString());
});

voice.post("/status", (req, res) => {
  if (["completed", "failed", "busy", "no-answer", "canceled"].includes(req.body.CallStatus)) {
    agent.endCall(req.body.CallSid);
    pending.delete(req.body.CallSid);
    misses.delete(req.body.CallSid);
    console.log(`[call] ${req.body.CallSid} ended (${req.body.CallStatus})`);
  }
  res.sendStatus(204);
});

app.use("/voice", voice);

// ---- SMS: same assistant, same read-back rule ("start pump 20 min" -> "Reply YES to confirm") ----
app.post("/sms", validateTwilio, async (req, res) => {
  const from = req.body.From;
  const text = String(req.body.Body || "").trim();
  const code = callers[from] || DEFAULT_LANG;
  const twiml = new MessagingResponse();
  if (ALLOWED_CALLERS.length && !ALLOWED_CALLERS.includes(from)) {
    twiml.message("Sorry, this number is not registered with the farm.");
  } else if (text) {
    console.log(`[sms] from ${from}: "${text}"`);
    const work = agent.handleTurn(`sms-${from}`, code, text, "sms").catch((err) => {
      console.error("[sms] agent error:", err.message);
      return { reply: lang(code).error };
    });
    const result = (await withTimeout(work, 13000)) || { reply: lang(code).error };
    console.log(`[sms] reply: "${result.reply}"`);
    twiml.message(result.reply);
  }
  res.type("text/xml").send(twiml.toString());
});

// ---- test API (no phone needed) ----
function requireToken(req, res, next) {
  const token = process.env.API_TOKEN;
  if (!token || req.get("x-api-token") === token || req.query.token === token) return next();
  res.status(401).json({ error: "missing or wrong API token" });
}

app.get("/api/status", requireToken, (req, res) => res.json(device.getState()));

// Talk to the assistant by text: {"text": "turn the pump on", "lang": "en", "session": "test"}
app.post("/api/chat", requireToken, async (req, res) => {
  const code = LANGUAGES[req.body.lang] ? req.body.lang : DEFAULT_LANG;
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const result = await agent.handleTurn(`web-${req.body.session || "default"}`, code, text);
    res.json({ ...result, device: device.getState() });
  } catch (err) {
    console.error("[api] agent error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/chat/reset", requireToken, (req, res) => {
  agent.endCall(`web-${req.body.session || "default"}`);
  res.json({ ok: true });
});

app.use(express.static(path.join(here, "..", "public")));

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] Twilio "A call comes in" webhook: ${PUBLIC_URL || "<PUBLIC_URL>"}/voice/incoming`);
});
