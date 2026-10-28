// A stand-in for the ESP32 that speaks the same MQTT protocol as the firmware.
// Run it next to the backend (with SIMULATOR=false) to test the real broker path without hardware.
// Usage: npm run fake-esp32

import "dotenv/config";
import mqtt from "mqtt";

const base = `${process.env.MQTT_TOPIC_PREFIX || "solarirrigation"}/${process.env.DEVICE_ID || "farm1"}`;
const MIN_WATER = 15;
const s = { pump: false, run_remaining_s: 0, moisture_pct: 28, water_level_pct: 80, battery_v: 12.5, solar_v: 18.9, temp_c: 30.2, net: "fake-esp32", rssi: -58, uptime_s: 0 };

const client = mqtt.connect(process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883", {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: `fake-esp32-${Math.random().toString(16).slice(2, 8)}`,
  will: { topic: `${base}/status`, payload: "offline", retain: true, qos: 1 },
});

const publishState = () => client.publish(`${base}/state`, JSON.stringify(s), { retain: true });

client.on("connect", () => {
  console.log(`[fake-esp32] connected, topics ${base}/*`);
  client.publish(`${base}/status`, "online", { retain: true, qos: 1 });
  client.subscribe(`${base}/cmd`, { qos: 1 });
  publishState();
});

client.on("message", (topic, payload) => {
  let cmd;
  try {
    cmd = JSON.parse(payload.toString());
  } catch {
    return;
  }
  console.log("[fake-esp32] command:", cmd);
  let error = null;
  if ((cmd.action === "pump_on" || cmd.action === "run") && s.water_level_pct < MIN_WATER) error = "water_low";
  else if (cmd.action === "pump_on") Object.assign(s, { pump: true, run_remaining_s: 0 });
  else if (cmd.action === "pump_off") Object.assign(s, { pump: false, run_remaining_s: 0 });
  else if (cmd.action === "run") Object.assign(s, { pump: true, run_remaining_s: Math.round(cmd.minutes * 60) });
  else if (cmd.action !== "status") error = "unknown_action";
  client.publish(`${base}/ack`, JSON.stringify({ id: cmd.id, ok: !error, pump: s.pump, run_remaining_s: s.run_remaining_s, error }), { qos: 1 });
  publishState();
});

setInterval(() => {
  s.uptime_s += 1;
  if (s.pump) {
    s.moisture_pct = Math.min(95, +(s.moisture_pct + 0.2).toFixed(1));
    s.water_level_pct = Math.max(0, +(s.water_level_pct - 0.05).toFixed(2));
    if (s.run_remaining_s > 0 && --s.run_remaining_s === 0) s.pump = false;
  }
  if (s.uptime_s % 5 === 0) publishState();
}, 1000);
