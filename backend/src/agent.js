// The "brain": turns what the farmer said into pump commands and a short spoken reply.
// Claude decides which tool to call (status, pump on/off, timed run, hang up); the tools talk to the ESP32.

import Anthropic from "@anthropic-ai/sdk";
import { lang } from "./languages.js";

const MODEL = process.env.AI_MODEL || "claude-opus-5-5";
// Low effort keeps phone replies fast; raise to "medium" if answers feel too shallow.
const EFFORT = process.env.AI_EFFORT || "low";
const MAX_RUN_MINUTES = Number(process.env.MAX_RUN_MINUTES || 120);
const MAX_TOOL_ROUNDS = 5;

const SCRIPTS = { en: "Latin", hi: "Devanagari", te: "Telugu", ta: "Tamil", kn: "Kannada" };

const TOOLS = [
  {
    name: "get_farm_status",
    description:
      "Read the latest readings from the field controller: whether the pump is on, minutes left on a timed run, soil moisture %, water tank level %, battery voltage, solar panel voltage, temperature, and whether the controller is online. Call this for any question about the farm's current condition.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "set_pump",
    description:
      "Switch the irrigation pump on or off. Turning it on with this tool runs it until someone turns it off (the controller still stops it automatically if the water tank runs low). Returns what the controller actually did.",
    input_schema: {
      type: "object",
      properties: { on: { type: "boolean", description: "true to switch on, false to switch off" } },
      required: ["on"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "run_pump_for_minutes",
    description: `Run the pump for a fixed number of minutes, after which the controller switches it off by itself (even if the network drops). Use this whenever the farmer gives a duration. minutes must be a whole number from 1 to ${MAX_RUN_MINUTES}; convert hours to minutes.`,
    input_schema: {
      type: "object",
      properties: { minutes: { type: "integer", description: `Duration in minutes, 1 to ${MAX_RUN_MINUTES}` } },
      required: ["minutes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "end_call",
    description:
      "Hang up after your reply is spoken. Use when the farmer says goodbye, thanks you and is done, or says there is nothing else.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
];

function systemPrompt(code) {
  const name = lang(code).name;
  return `You are a friendly voice assistant on a phone call with a farmer. You control the farm's solar-powered irrigation pump and read its field sensors through your tools.

Language: reply only in ${name}, written in ${SCRIPTS[code]} script, because a text-to-speech voice reads your reply aloud. The caller's words come from speech recognition, so expect recognition mistakes and mixed-in English words such as pump, motor, on, off, start, stop; interpret them generously.

How to speak: one to three short, plain sentences. No lists, markdown, symbols or emojis. Round numbers and give units in words, for example "32 percent" or "12.6 volts".

Rules:
- Never guess readings or pump state. Use get_farm_status, and after a pump command report what the tool result says actually happened.
- If the farmer gives a duration ("run the pump for 10 minutes", "half an hour"), use run_pump_for_minutes. If they just say turn on or start, use set_pump.
- If the controller is offline or a command times out, say so plainly and suggest checking the controller's power and network.
- If the pump refused to start with error water_low, explain that the water tank is too low and the pump is protected from running dry.
- Soil moisture guide: below 30 percent is dry and needs water, 30 to 60 percent is good, above 60 percent is wet enough.
- When the farmer is done or says goodbye, say a short goodbye and call end_call.
- For questions unrelated to the farm, give a brief polite answer and offer help with the pump.`;
}

class ClaudeAgent {
  constructor(device) {
    this.device = device;
    this.client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
    this.calls = new Map(); // callId -> { lang, messages }
  }

  async runTool(name, input) {
    const d = this.device;
    switch (name) {
      case "get_farm_status":
        return d.getState();
      case "set_pump":
        return await d.sendCommand(input.on ? "pump_on" : "pump_off");
      case "run_pump_for_minutes": {
        const minutes = Number(input.minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_RUN_MINUTES) {
          return { ok: false, error: `minutes must be a whole number from 1 to ${MAX_RUN_MINUTES}` };
        }
        return await d.sendCommand("run", { minutes });
      }
      case "end_call":
        return { ok: true };
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  }

  async handleTurn(callId, code, text) {
    if (!this.calls.has(callId)) this.calls.set(callId, { lang: code, messages: [] });
    const call = this.calls.get(callId);
    // History is append-only: every response's full content (thinking blocks included) is sent back unchanged.
    call.messages.push({ role: "user", content: text });

    let hangup = false;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: EFFORT },
        system: systemPrompt(call.lang),
        tools: TOOLS,
        messages: call.messages,
      });

      if (response.stop_reason === "refusal") {
        console.warn("[agent] refusal:", response.stop_details?.category);
        return { reply: lang(call.lang).error, hangup: false };
      }
      call.messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const reply = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        return { reply: reply || lang(call.lang).again, hangup };
      }

      const results = [];
      for (const tu of toolUses) {
        if (tu.name === "end_call") hangup = true;
        let result;
        let isError = false;
        try {
          result = await this.runTool(tu.name, tu.input);
        } catch (err) {
          result = { ok: false, error: err.message };
          isError = true;
        }
        console.log(`[agent] ${tu.name}(${JSON.stringify(tu.input)}) ->`, JSON.stringify(result));
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), is_error: isError });
      }
      call.messages.push({ role: "user", content: results });
    }
    return { reply: lang(call.lang).error, hangup };
  }

  endCall(callId) {
    this.calls.delete(callId);
  }
}

// Keyword fallback for running without an Anthropic API key (offline testing, or as a demo backup).
// English replies only; it understands simple on/off/timed/status phrases in all five languages.
class RulesAgent {
  constructor(device) {
    this.device = device;
    console.warn("[agent] AI_MODE=rules: using the keyword fallback instead of Claude");
  }

  async handleTurn(callId, code, text) {
    const t = text.toLowerCase();
    const has = (words) => words.some((w) => t.includes(w));
    const minutes = t.match(/(\d+)\s*(min|मिनट|నిమి|நிமி|ನಿಮಿ)/);
    const hours = t.match(/(\d+)\s*(hour|घंट|గంట|மணி|ಗಂಟೆ)/);
    const off = has(["off", "stop", "band", "बंद", "ఆఫ్", "ఆపు", "ஆஃப்", "நிறுத்து", "ಆಫ್", "ನಿಲ್ಲಿಸು"]);
    const on = has([" on", "start", "chalu", "चालू", "चला", "ఆన్", "ஆன்", "ಆನ್"]) || t.startsWith("on");
    try {
      if (has(["bye", "thank", "धन्यवाद", "ధన్యవాద", "நன்றி", "ಧನ್ಯವಾದ"])) {
        return { reply: "Goodbye!", hangup: true };
      }
      if (off) {
        const r = await this.device.sendCommand("pump_off");
        return { reply: r.ok ? "The pump is now off." : `The pump did not stop: ${r.error}.`, hangup: false };
      }
      if (on || minutes || hours) {
        const mins = minutes ? Number(minutes[1]) : hours ? Number(hours[1]) * 60 : 0;
        const r = mins
          ? await this.device.sendCommand("run", { minutes: Math.min(mins, MAX_RUN_MINUTES) })
          : await this.device.sendCommand("pump_on");
        if (!r.ok) {
          return {
            reply: r.error === "water_low" ? "The tank is too low, so the pump stayed off to protect it." : `The pump did not start: ${r.error}.`,
            hangup: false,
          };
        }
        return { reply: mins ? `The pump is on for ${mins} minutes.` : "The pump is now on.", hangup: false };
      }
      const s = this.device.getState();
      if (!s.online) return { reply: "The field controller is offline right now.", hangup: false };
      return {
        reply: `The pump is ${s.pump ? "on" : "off"}. Soil moisture is ${s.soil_moisture_pct} percent, the tank is ${s.water_level_pct} percent full, battery ${s.battery_v} volts, solar ${s.solar_v} volts, temperature ${s.temperature_c} degrees.`,
        hangup: false,
      };
    } catch (err) {
      return { reply: `Sorry, the controller did not respond (${err.message}).`, hangup: false };
    }
  }

  endCall() {}
}

export function createAgent(device) {
  const noKey = !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
  if (process.env.AI_MODE === "rules" || (noKey && process.env.AI_MODE !== "claude")) {
    if (noKey && process.env.AI_MODE !== "rules") console.warn("[agent] ANTHROPIC_API_KEY is not set");
    return new RulesAgent(device);
  }
  console.log(`[agent] using ${MODEL} (effort ${EFFORT})`);
  return new ClaudeAgent(device);
}
