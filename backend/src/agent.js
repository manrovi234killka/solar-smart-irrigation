// The "brain": turns what the farmer said (voice or SMS) into pump commands and a short reply.
// Claude decides which tool to call; the tools talk to the ESP32.
//
// Safety rule from the project design: the assistant reads every start command back and waits for a clear
// yes. This is enforced in code, not only in the prompt: start_pump (and turning auto mode on) only runs
// when the same request was already read back in the previous turn and the farmer has spoken since.
// Stopping the pump never needs a confirmation.

import Anthropic from "@anthropic-ai/sdk";
import { lang } from "./languages.js";
import { getForecast } from "./weather.js";

const MODEL = process.env.AI_MODEL || "claude-opus-5-5";
// Low effort keeps phone replies fast; raise to "medium" if answers feel too shallow.
const EFFORT = process.env.AI_EFFORT || "low";
const MAX_RUN_MINUTES = Number(process.env.MAX_RUN_MINUTES || 60);
const DEFAULT_RUN_MINUTES = Number(process.env.DEFAULT_RUN_MINUTES || 20);
const MAX_TOOL_ROUNDS = 6;
const IDLE_FORGET_MS = 30 * 60_000;

const SCRIPTS = { en: "Latin", hi: "Devanagari", te: "Telugu", ta: "Tamil", kn: "Kannada" };
const NEEDS_YES = {
  ok: false,
  needs_confirmation: true,
  note: "Nothing was changed yet. Read this exact request back to the farmer and ask them to say yes. Call the tool again with the same input only after their next reply is a clear yes.",
};

const noProps = { type: "object", properties: {}, required: [], additionalProperties: false };
const TOOLS = [
  {
    name: "get_farm_status",
    description:
      "Latest readings from the field controller: pump on/off and minutes left, who started it (voice or auto), auto mode and whether it is paused, rain forecast flag, soil moisture %, the auto-mode dry limit and target %, tank-full and source-empty float switches, battery and solar voltage, temperature, and whether the controller is online. Call this for any question about the farm's condition.",
    input_schema: noProps,
    strict: true,
  },
  {
    name: "start_pump",
    description: `Start the irrigation pump for a number of minutes; the controller stops it by itself when the time is up, when the tank is full or the water source is empty. Use ${DEFAULT_RUN_MINUTES} minutes when the farmer gives no duration. minutes must be a whole number from 1 to ${MAX_RUN_MINUTES}; convert hours to minutes. The first call only registers the request and returns needs_confirmation: read it back and ask for a yes before calling again.`,
    input_schema: {
      type: "object",
      properties: { minutes: { type: "integer", description: `Run time in minutes, 1 to ${MAX_RUN_MINUTES}` } },
      required: ["minutes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "stop_pump",
    description: "Stop the pump immediately. No confirmation needed. Automatic watering then pauses for an hour.",
    input_schema: noProps,
    strict: true,
  },
  {
    name: "set_auto_mode",
    description:
      "Turn automatic watering on or off. In auto mode the controller waters when the soil is drier than its dry limit, stops at its target, and skips watering when rain is forecast. Turning it on needs the same read-back and yes as start_pump; turning it off does not.",
    input_schema: {
      type: "object",
      properties: { on: { type: "boolean" } },
      required: ["on"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_weather_forecast",
    description: "Rain chance, rain amount and temperatures for the farm for the next 3 days.",
    input_schema: noProps,
    strict: true,
  },
  {
    name: "end_call",
    description: "Hang up after your reply is spoken. Use when the farmer says goodbye or says there is nothing else.",
    input_schema: noProps,
    strict: true,
  },
];

function systemPrompt(code, channel) {
  const L = lang(code);
  const style =
    channel === "sms"
      ? `This conversation is by SMS. Reply in the language the farmer writes in (their usual language is ${L.name}), in at most 300 characters of plain text.`
      : `This is a phone call. Reply only in ${L.name}, written in ${SCRIPTS[code]} script, because a text-to-speech voice reads your reply aloud. The caller's words come from speech recognition, so expect recognition mistakes and mixed-in English words such as pump, motor, on, off, start, stop; interpret them generously. Use one to three short, plain sentences with no lists, markdown, symbols or emojis.`;
  return `You are a friendly assistant for a small farm's solar-powered irrigation system. You talk with the farmer, control the pump and read the field sensors through your tools.

${style}

Rules:
- Never guess readings or pump state; use get_farm_status. After any command, report what the tool result says actually happened.
- Starting the pump or turning auto mode on always takes two steps. First call the tool: it returns needs_confirmation. Then read the request back in simple words, for example "Shall I start the pump for 20 minutes? Please say yes or no." Only when the farmer's next reply is a clear yes, call the same tool again with the same input. If they say no or change the request, do not start it.
- Stopping the pump is immediate: call stop_pump straight away, no read-back.
- If a start fails with source_empty, the water source is empty, so the pump is protected from running dry. With tank_full, the tank is already full.
- If the controller is offline or a command times out, say so plainly and suggest checking the controller's power and network.
- Say numbers with units in words, for example "32 percent" or "12.6 volts". Soil moisture below the dry limit means the field needs water.
- Weather only informs; never start the pump because of a forecast.
- When the farmer is done or says goodbye, say a short goodbye and call end_call.
- For farming questions you are not sure about, say so and suggest asking the local agriculture officer.`;
}

// Read-back gate: returns null when the action may run now, or the needs-confirmation result.
function confirmGate(conv, key) {
  if (conv.pending && conv.pending.key === key && conv.pending.turn === conv.turn - 1) {
    conv.pending = null;
    return null;
  }
  conv.pending = { key, turn: conv.turn };
  return NEEDS_YES;
}

async function runTool(device, conv, name, input) {
  switch (name) {
    case "get_farm_status":
      return device.getState();
    case "start_pump": {
      const minutes = Number(input.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_RUN_MINUTES) {
        return { ok: false, error: `minutes must be a whole number from 1 to ${MAX_RUN_MINUTES}` };
      }
      return confirmGate(conv, `start:${minutes}`) || (await device.sendCommand("run", { minutes }));
    }
    case "stop_pump":
      conv.pending = null;
      return await device.sendCommand("pump_off");
    case "set_auto_mode":
      if (input.on) return confirmGate(conv, "auto:on") || (await device.sendCommand("set_auto", { on: true }));
      return await device.sendCommand("set_auto", { on: false });
    case "get_weather_forecast":
      return await getForecast();
    case "end_call":
      return { ok: true };
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

class Conversations {
  constructor() {
    this.map = new Map();
    setInterval(() => {
      for (const [id, c] of this.map) if (Date.now() - c.lastActive > IDLE_FORGET_MS) this.map.delete(id);
    }, 60_000).unref();
  }
  get(id, code, channel) {
    if (!this.map.has(id)) this.map.set(id, { lang: code, channel, messages: [], turn: 0, pending: null });
    const c = this.map.get(id);
    c.lastActive = Date.now();
    c.turn++;
    return c;
  }
  end(id) {
    this.map.delete(id);
  }
}

class ClaudeAgent {
  constructor(device) {
    this.device = device;
    this.client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
    this.convs = new Conversations();
  }

  async handleTurn(convId, code, text, channel = "voice") {
    const conv = this.convs.get(convId, code, channel);
    // History is append-only: every response's full content (thinking blocks included) is sent back unchanged.
    conv.messages.push({ role: "user", content: text });

    let hangup = false;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: EFFORT },
        system: systemPrompt(conv.lang, conv.channel),
        tools: TOOLS,
        messages: conv.messages,
      });

      if (response.stop_reason === "refusal") {
        console.warn("[agent] refusal:", response.stop_details?.category);
        return { reply: lang(conv.lang).error, hangup: false };
      }
      conv.messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const reply = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        return { reply: reply || lang(conv.lang).again, hangup };
      }

      const results = [];
      for (const tu of toolUses) {
        if (tu.name === "end_call") hangup = true;
        let result;
        let isError = false;
        try {
          result = await runTool(this.device, conv, tu.name, tu.input);
        } catch (err) {
          result = { ok: false, error: err.message };
          isError = true;
        }
        console.log(`[agent] ${tu.name}(${JSON.stringify(tu.input)}) ->`, JSON.stringify(result));
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), is_error: isError });
      }
      conv.messages.push({ role: "user", content: results });
    }
    return { reply: lang(conv.lang).error, hangup };
  }

  endCall(convId) {
    this.convs.end(convId);
  }
}

// Keyword fallback for running without an Anthropic API key (offline testing, or as a demo backup).
// English replies only; it understands simple phrases in all five languages, with the same read-back rule.
const has = (t, words) => words.some((w) => t.includes(w));
const YES = ["yes", "yeah", "ok", "okay", "haan", "हाँ", "हां", "ठीक", "avunu", "అవును", "sare", "సరే", "aamam", "ஆமாம்", "சரி", "houdu", "ಹೌದು", "ಸರಿ"];
const OFF = ["off", "stop", "band", "बंद", "ఆఫ్", "ఆపు", "ஆஃப்", "நிறுத்து", "ಆಫ್", "ನಿಲ್ಲಿಸು"];
const ON = [" on", "start", "chalu", "चालू", "चला", "ఆన్", "ஆன்", "ಆನ್"];
const BYE = ["bye", "thank", "धन्यवाद", "ధన్యవాద", "நன்றி", "ಧನ್ಯವಾದ"];
const AUTO = ["auto", "ऑटो", "ఆటో", "ஆட்டோ", "ಆಟೋ"];

class RulesAgent {
  constructor(device) {
    this.device = device;
    this.convs = new Conversations();
    console.warn("[agent] AI_MODE=rules: using the keyword fallback instead of Claude");
  }

  async handleTurn(convId, code, text) {
    const conv = this.convs.get(convId, code, "voice");
    const t = ` ${text.toLowerCase()} `;
    const pending = conv.pending;
    conv.pending = null;
    try {
      if (has(t, OFF) && !has(t, AUTO)) {
        const r = await this.device.sendCommand("pump_off");
        return { reply: r.ok ? "The pump is now off." : `The pump did not stop: ${r.error}.`, hangup: false };
      }
      if (pending && has(t, YES)) {
        const r = pending.minutes
          ? await this.device.sendCommand("run", { minutes: pending.minutes })
          : await this.device.sendCommand("set_auto", { on: true });
        if (!r.ok) {
          const why = { source_empty: "the water source is empty", tank_full: "the tank is already full" }[r.error] || r.error;
          return { reply: `The pump did not start because ${why}.`, hangup: false };
        }
        return { reply: pending.minutes ? `Done. The pump is on for ${pending.minutes} minutes.` : "Auto mode is on.", hangup: false };
      }
      if (has(t, BYE)) return { reply: "Goodbye!", hangup: true };
      if (has(t, AUTO)) {
        if (has(t, OFF)) {
          await this.device.sendCommand("set_auto", { on: false });
          return { reply: "Auto mode is off.", hangup: false };
        }
        conv.pending = { auto: true };
        return { reply: "Shall I turn auto mode on? Please say yes or no.", hangup: false };
      }
      const minutes = t.match(/(\d+)\s*(min|मिनट|నిమి|நிமி|ನಿಮಿ)/);
      const hours = t.match(/(\d+)\s*(hour|घंट|గంట|மணி|ಗಂಟೆ)/);
      if (has(t, ON) || minutes || hours) {
        const mins = Math.min(minutes ? Number(minutes[1]) : hours ? Number(hours[1]) * 60 : DEFAULT_RUN_MINUTES, MAX_RUN_MINUTES);
        conv.pending = { minutes: mins };
        return { reply: `Shall I start the pump for ${mins} minutes? Please say yes or no.`, hangup: false };
      }
      if (pending) return { reply: "Okay, I did not start anything.", hangup: false };
      const s = this.device.getState();
      if (!s.online) return { reply: "The field controller is offline right now.", hangup: false };
      return {
        reply: `The pump is ${s.pump ? `on, ${s.run_remaining_min} minutes left` : "off"}. Soil moisture is ${s.soil_moisture_pct} percent. Auto mode is ${s.auto_mode ? "on" : "off"}. Battery ${s.battery_v} volts, solar ${s.solar_v} volts.`,
        hangup: false,
      };
    } catch (err) {
      return { reply: `Sorry, the controller did not respond (${err.message}).`, hangup: false };
    }
  }

  endCall(convId) {
    this.convs.end(convId);
  }
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
