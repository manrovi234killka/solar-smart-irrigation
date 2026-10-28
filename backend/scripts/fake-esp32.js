// A stand-in for the ESP32 that speaks the same MQTT protocol as the firmware and follows the same rules
// (it reuses the backend's simulator). Run it next to the backend (with SIMULATOR=false) to test the real
// broker path without hardware.
// Usage: npm run fake-esp32

import "dotenv/config";
import mqtt from "mqtt";
import { SimulatedDevice } from "../src/device.js";

const base = `${process.env.MQTT_TOPIC_PREFIX || "solarirrigation"}/${process.env.DEVICE_ID || "farm1"}`;
const sim = new SimulatedDevice({ quiet: true });
sim.raw.net = "fake-esp32";

const client = mqtt.connect(process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883", {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: `fake-esp32-${Math.random().toString(16).slice(2, 8)}`,
  will: { topic: `${base}/status`, payload: "offline", retain: true, qos: 1 },
});

const publishState = () =>
  client.publish(`${base}/state`, JSON.stringify({ ...sim.raw, moisture_pct: Math.round(sim.raw.moisture_pct) }), { retain: true });

client.on("connect", () => {
  console.log(`[fake-esp32] connected, topics ${base}/*`);
  client.publish(`${base}/status`, "online", { retain: true, qos: 1 });
  client.subscribe(`${base}/cmd`, { qos: 1 });
  publishState();
});

client.on("message", async (topic, payload) => {
  let cmd;
  try {
    cmd = JSON.parse(payload.toString());
  } catch {
    return;
  }
  console.log("[fake-esp32] command:", cmd);
  const { id, action, ...extra } = cmd;
  const ack = await sim.sendCommand(action, extra);
  client.publish(`${base}/ack`, JSON.stringify({ id, ...ack }), { qos: 1 });
  publishState();
});

setInterval(publishState, 5000);
