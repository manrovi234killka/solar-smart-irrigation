// Command channel to the ESP32 pump controller.
//
// Two transports with the same interface:
//   - MqttDevice: the real ESP32 (Wi-Fi or SIM7600/SIM800 cellular) via an MQTT broker.
//   - SimulatedDevice: an in-process fake so the whole call flow can be demoed without hardware.
//
// MQTT topics (base = <MQTT_TOPIC_PREFIX>/<DEVICE_ID>):
//   base/cmd     backend -> ESP32   {"id":"..","action":"pump_on"|"pump_off"|"run"|"status","minutes":10}
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
    run_remaining_s: Number(raw.run_remaining_s || 0),
    soil_moisture_pct: raw.moisture_pct ?? null,
    water_level_pct: raw.water_level_pct ?? null,
    battery_v: raw.battery_v ?? null,
    solar_v: raw.solar_v ?? null,
    temperature_c: raw.temp_c ?? null,
    network: raw.net ?? null,
    signal_dbm: raw.rssi ?? null,
    uptime_s: raw.uptime_s ?? null,
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

// Behaves like the firmware: dry-run protection, timed runs, sensors drifting while the pump runs.
class SimulatedDevice {
  constructor() {
    this.raw = {
      pump: false,
      run_remaining_s: 0,
      moisture_pct: 32,
      water_level_pct: 78,
      battery_v: 12.6,
      solar_v: 18.4,
      temp_c: 31.5,
      net: "simulated",
      rssi: -60,
      uptime_s: 0,
    };
    this.minWaterPct = Number(process.env.SIM_MIN_WATER_PCT || 15);
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    console.log("[sim] using the built-in simulated ESP32 (SIMULATOR=true)");
  }

  tick() {
    const r = this.raw;
    r.uptime_s += 1;
    if (r.pump) {
      r.moisture_pct = Math.min(95, r.moisture_pct + 0.2);
      r.water_level_pct = Math.max(0, r.water_level_pct - 0.05);
      if (r.water_level_pct < this.minWaterPct) this.setPump(false);
      if (r.run_remaining_s > 0 && --r.run_remaining_s === 0) this.setPump(false);
    } else {
      r.moisture_pct = Math.max(10, r.moisture_pct - 0.01);
    }
  }

  setPump(on, seconds = 0) {
    this.raw.pump = on;
    this.raw.run_remaining_s = on ? seconds : 0;
  }

  isOnline() {
    return true;
  }

  getState() {
    const s = normalizeState(this.raw);
    for (const k of ["soil_moisture_pct", "water_level_pct"]) s[k] = Math.round(s[k]);
    return { online: true, last_report_s_ago: 0, ...s };
  }

  async sendCommand(action, extra = {}) {
    await new Promise((r) => setTimeout(r, 150));
    const r = this.raw;
    if ((action === "pump_on" || action === "run") && r.water_level_pct < this.minWaterPct) {
      return { ok: false, pump: r.pump, error: "water_low" };
    }
    if (action === "pump_on") this.setPump(true);
    else if (action === "pump_off") this.setPump(false);
    else if (action === "run") this.setPump(true, Math.round(extra.minutes * 60));
    return { ok: true, pump: r.pump, run_remaining_s: r.run_remaining_s, error: null };
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
