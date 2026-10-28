// Command channel to the ESP32 pump controller.
//
// Two transports with the same interface:
//   - MqttDevice: the real ESP32 (Wi-Fi or SIM800L/SIM7600 cellular) via an MQTT broker.
//   - SimulatedDevice: an in-process fake that follows the firmware's rules, for demos without hardware.
//
// MQTT topics (base = <MQTT_TOPIC_PREFIX>/<DEVICE_ID>):
//   base/cmd     backend -> ESP32   {"id":"..","action":"run","minutes":10}
//                                   actions: run, pump_off, set_auto {on}, set_rain {rain}, status
//   base/ack     ESP32 -> backend   {"id":"..","ok":true,"pump":true,"run_remaining_s":600,"error":null}
//   base/state   ESP32 -> backend   sensor snapshot (retained), see normalizeState()
//   base/status  ESP32 -> backend   "online" / "offline" (retained, offline is the MQTT last will)

import mqtt from "mqtt";
import { randomUUID } from "node:crypto";

const ACK_TIMEOUT_MS = Number(process.env.ACK_TIMEOUT_MS || 8000);
const STALE_AFTER_MS = 60_000;

function normalizeState(raw) {
  return {
    pump: Boolean(raw.pump),
    run_remaining_min: raw.run_remaining_s ? Math.ceil(raw.run_remaining_s / 60) : 0,
    started_by: raw.started_by || null,
    auto_mode: Boolean(raw.auto_mode),
    auto_paused_min: raw.auto_hold_s ? Math.ceil(raw.auto_hold_s / 60) : 0,
    rain_forecast: Boolean(raw.rain_forecast),
    soil_moisture_pct: raw.moisture_pct ?? null,
    auto_dry_limit_pct: raw.dry_limit_pct ?? null,
    auto_target_pct: raw.target_pct ?? null,
    tank_full: Boolean(raw.tank_full),
    source_empty: Boolean(raw.source_empty),
    battery_v: raw.battery_v ?? null,
    solar_v: raw.solar_v ?? null,
    temperature_c: raw.temp_c ?? null,
    network: raw.net ?? null,
    signal_dbm: raw.rssi ?? null,
  };
}

class MqttDevice {
  constructor({ url, username, password, prefix, deviceId }) {
    this.base = `${prefix}/${deviceId}`;
    this.state = null;
    this.lastSeen = 0;
    this.status = "unknown";
    this.pending = new Map();

    this.client = mqtt.connect(url, {
      username: username || undefined,
      password: password || undefined,
      clientId: `irrigation-backend-${randomUUID().slice(0, 8)}`,
      reconnectPeriod: 3000,
    });
    this.client.on("connect", () => {
      console.log(`[mqtt] connected to ${url}, listening on ${this.base}/#`);
      this.client.subscribe(`${this.base}/+`, { qos: 1 });
    });
    this.client.on("error", (err) => console.error("[mqtt] error:", err.message));
    this.client.on("message", (topic, payload) => this.onMessage(topic, payload.toString()));
  }

  onMessage(topic, text) {
    const leaf = topic.slice(this.base.length + 1);
    if (leaf === "status") {
      this.status = text.trim();
      return;
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (leaf === "state") {
      this.state = normalizeState(msg);
      this.lastSeen = Date.now();
    } else if (leaf === "ack" && this.pending.has(msg.id)) {
      this.lastSeen = Date.now();
      const { resolve, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      resolve(msg);
    }
  }

  isOnline() {
    if (this.status === "offline") return false;
    return Date.now() - this.lastSeen < STALE_AFTER_MS;
  }

  getState() {
    return {
      online: this.isOnline(),
      last_report_s_ago: this.lastSeen ? Math.round((Date.now() - this.lastSeen) / 1000) : null,
      ...(this.state || {}),
    };
  }

  sendCommand(action, extra = {}) {
    const id = randomUUID().slice(0, 8);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("device_timeout"));
      }, ACK_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.client.publish(`${this.base}/cmd`, JSON.stringify({ id, action, ...extra }), { qos: 1 });
    });
  }

  close() {
    this.client.end(true);
  }
}

// Follows the firmware's rules: float-switch cut-offs, timed runs, auto mode with rain skip.
export class SimulatedDevice {
  constructor({ quiet = false } = {}) {
    this.cfg = { dryLimit: 35, target: 70, autoRunMin: 20, autoHoldMin: 60, maxRunMin: Number(process.env.MAX_RUN_MINUTES || 60) };
    this.raw = {
      pump: false,
      run_remaining_s: 0,
      started_by: "",
      auto_mode: true,
      auto_hold_s: 0,
      rain_forecast: false,
      moisture_pct: 38,
      dry_limit_pct: this.cfg.dryLimit,
      target_pct: this.cfg.target,
      tank_full: false,
      source_empty: String(process.env.SIM_SOURCE_EMPTY).toLowerCase() === "true",
      battery_v: 12.6,
      solar_v: 18.4,
      temp_c: 31.5,
      net: "simulated",
      rssi: -60,
    };
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    if (!quiet) console.log("[sim] using the built-in simulated ESP32 (SIMULATOR=true)");
  }

  blocked() {
    return this.raw.source_empty ? "source_empty" : this.raw.tank_full ? "tank_full" : null;
  }

  tick() {
    const r = this.raw;
    if (r.auto_hold_s > 0) r.auto_hold_s--;
    if (r.pump) {
      r.moisture_pct = Math.min(95, r.moisture_pct + 0.3);
      r.run_remaining_s--;
      if (this.blocked() || r.run_remaining_s <= 0 || (r.started_by === "auto" && r.moisture_pct >= this.cfg.target)) {
        this.setPump(false);
      }
    } else {
      r.moisture_pct = Math.max(10, r.moisture_pct - 0.01);
      if (r.auto_mode && !r.rain_forecast && r.auto_hold_s === 0 && !this.blocked() && r.moisture_pct < this.cfg.dryLimit) {
        this.setPump(true, this.cfg.autoRunMin * 60, "auto");
      }
    }
  }

  setPump(on, seconds = 0, by = "") {
    Object.assign(this.raw, { pump: on, run_remaining_s: on ? seconds : 0, started_by: on ? by : "" });
  }

  isOnline() {
    return true;
  }

  getState() {
    const s = normalizeState(this.raw);
    s.soil_moisture_pct = Math.round(s.soil_moisture_pct);
    return { online: true, last_report_s_ago: 0, ...s };
  }

  async sendCommand(action, extra = {}) {
    await new Promise((r) => setTimeout(r, 100));
    const r = this.raw;
    let error = null;
    if (action === "run") {
      const m = extra.minutes;
      if (!Number.isInteger(m) || m < 1 || m > this.cfg.maxRunMin) error = "bad_minutes";
      else if (!(error = this.blocked())) this.setPump(true, m * 60, "voice");
    } else if (action === "pump_off") {
      this.setPump(false);
      r.auto_hold_s = this.cfg.autoHoldMin * 60;
    } else if (action === "set_auto") {
      r.auto_mode = Boolean(extra.on);
      r.auto_hold_s = 0;
    } else if (action === "set_rain") {
      r.rain_forecast = Boolean(extra.rain);
    } else if (action !== "status") {
      error = "unknown_action";
    }
    return { ok: !error, pump: r.pump, run_remaining_s: r.run_remaining_s, auto_mode: r.auto_mode, error };
  }

  close() {
    clearInterval(this.timer);
  }
}

export function createDevice() {
  if (String(process.env.SIMULATOR).toLowerCase() === "true") return new SimulatedDevice();
  return new MqttDevice({
    url: process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883",
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    prefix: process.env.MQTT_TOPIC_PREFIX || "solarirrigation",
    deviceId: process.env.DEVICE_ID || "farm1",
  });
}
