// Solar Smart Irrigation: ESP32 pump controller.
// - Automatic mode: waters when soil moisture drops below DRY_LIMIT, stops at TARGET, skips while rain is forecast.
// - Remote control: receives commands from the phone-call / SMS voice assistant over MQTT and reports readings.
// - Safety rules run on the ESP32 itself and keep working offline: every run ends on a timer, the tank-full
//   and source-empty float switches stop the pump, and the pump is off at boot.
// Network: Wi-Fi, or a SIM800L/SIM7600 cellular modem (USE_GSM in config.h).
//
// MQTT topics (base = MQTT_TOPIC_PREFIX/DEVICE_ID):
//   base/cmd     <- {"id":"ab12","action":"run","minutes":10}
//                   actions: run (minutes), pump_off, set_auto (on: bool), set_rain (rain: bool), status
//   base/ack     -> {"id":"ab12","ok":true,"pump":true,"run_remaining_s":600,"error":null}
//   base/state   -> sensor snapshot (retained), every STATE_INTERVAL_MS and after every change
//   base/status  -> "online" / "offline" (retained; "offline" is the MQTT last will)
//
// Libraries (Arduino Library Manager): PubSubClient, ArduinoJson (v7),
//   DHT sensor library (if DHT_TYPE != 0), TinyGSM (if USE_GSM = 1).

#include "config.h"
#include <PubSubClient.h>
#include <ArduinoJson.h>

#if USE_GSM
  #if defined(GSM_MODEM_SIM7600)
    #define TINY_GSM_MODEM_SIM7600
  #else
    #define TINY_GSM_MODEM_SIM800
  #endif
  #define TINY_GSM_RX_BUFFER 1024
  #include <TinyGsmClient.h>
  HardwareSerial SerialAT(1);
  TinyGsm modem(SerialAT);
  #if MQTT_TLS
    TinyGsmClientSecure netClient(modem);  // SIM7600 only; SIM800 TLS is unreliable
  #else
    TinyGsmClient netClient(modem);
  #endif
#else
  #include <WiFi.h>
  #if MQTT_TLS
    #include <WiFiClientSecure.h>
    WiFiClientSecure netClient;
  #else
    WiFiClient netClient;
  #endif
#endif

#if DHT_TYPE != 0 && !FAKE_SENSORS
  #include <DHT.h>
  DHT dht(DHT_PIN, DHT_TYPE == 22 ? DHT22 : DHT11);
#endif

PubSubClient mqtt(netClient);

String topicBase = String(MQTT_TOPIC_PREFIX) + "/" + DEVICE_ID;
String topicCmd = topicBase + "/cmd";
String topicAck = topicBase + "/ack";
String topicState = topicBase + "/state";
String topicStatus = topicBase + "/status";

// ---------- pump and mode state ----------
bool pumpOn = false;
const char* startedBy = "";       // "voice" or "auto"
unsigned long pumpStartedMs = 0;
unsigned long runDurationMs = 0;  // every run has a timer
bool autoMode = AUTO_MODE_DEFAULT;
unsigned long autoHoldUntilMs = 0;  // auto mode paused after a manual stop
bool rainForecast = false;
unsigned long rainSetMs = 0;

// ---------- latest readings ----------
float moisturePct = 0, batteryV = 0, solarV = 0, tempC = NAN;
bool tankFull = false, sourceEmpty = false;

unsigned long lastStateMs = 0, lastSensorMs = 0, lastReconnectMs = 0;
bool stateDirty = true;

void setRelay(bool on) {
  digitalWrite(RELAY_PIN, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
}

void setPump(bool on, unsigned long durationMs = 0, const char* by = "") {
  pumpOn = on;
  pumpStartedMs = millis();
  runDurationMs = on ? durationMs : 0;
  startedBy = on ? by : "";
  setRelay(on);
  stateDirty = true;
  if (on) Serial.printf("[pump] ON for %lu min (%s)\n", durationMs / 60000, by);
  else Serial.println("[pump] OFF");
}

long runRemainingS() {
  if (!pumpOn) return 0;
  unsigned long elapsed = millis() - pumpStartedMs;
  return elapsed >= runDurationMs ? 0 : (runDurationMs - elapsed) / 1000;
}

long autoHoldS() {
  long left = (long)(autoHoldUntilMs - millis());
  return left > 0 ? left / 1000 : 0;
}

// ---------- sensors ----------
float clampPct(float v) { return v < 0 ? 0 : (v > 100 ? 100 : v); }

void readSensors() {
#if FAKE_SENSORS
  // Plausible demo values: the soil dries slowly and gets wetter while the pump runs.
  static bool init = false;
  if (!init) { moisturePct = 38; init = true; }
  moisturePct = clampPct(moisturePct + (pumpOn ? 0.8 : -0.03));
  batteryV = 12.4 + random(-10, 10) / 100.0;
  solarV = 18.5 + random(-50, 50) / 100.0;
  tempC = 30.5 + random(-10, 10) / 10.0;
  tankFull = false;
  sourceEmpty = false;
#else
  long sum = 0;
  for (int i = 0; i < 10; i++) { sum += analogRead(SOIL_PIN); delay(2); }  // average 10 readings
  moisturePct = clampPct(100.0 * (SOIL_DRY_RAW - sum / 10.0) / (SOIL_DRY_RAW - SOIL_WET_RAW));
  #if USE_FLOATS
    tankFull = digitalRead(TANK_FULL_PIN) == LOW;        // float closed = tank full
    sourceEmpty = digitalRead(SOURCE_EMPTY_PIN) == LOW;  // float closed = source empty
  #endif
  #if USE_VOLTAGE_SENSE
    batteryV = analogReadMilliVolts(BATTERY_PIN) / 1000.0 * BATTERY_DIVIDER;
    solarV = analogReadMilliVolts(SOLAR_PIN) / 1000.0 * SOLAR_DIVIDER;
  #endif
  #if DHT_TYPE != 0
    float t = dht.readTemperature();
    if (!isnan(t)) tempC = t;
  #endif
#endif
}

// ---------- MQTT publishing ----------
int signalDbm() {
#if USE_GSM
  int csq = modem.getSignalQuality();  // 0..31, 99 = unknown
  return (csq == 99 || csq == 0) ? 0 : -113 + 2 * csq;
#else
  return WiFi.RSSI();
#endif
}

void publishState() {
  JsonDocument doc;
  doc["pump"] = pumpOn;
  doc["run_remaining_s"] = runRemainingS();
  doc["started_by"] = startedBy;
  doc["auto_mode"] = autoMode;
  doc["auto_hold_s"] = autoHoldS();
  doc["rain_forecast"] = rainForecast;
  doc["moisture_pct"] = (int)round(moisturePct);
  doc["dry_limit_pct"] = DRY_LIMIT;
  doc["target_pct"] = TARGET;
  doc["tank_full"] = tankFull;
  doc["source_empty"] = sourceEmpty;
#if USE_VOLTAGE_SENSE || FAKE_SENSORS
  doc["battery_v"] = round(batteryV * 10) / 10.0;
  doc["solar_v"] = round(solarV * 10) / 10.0;
#endif
  if (!isnan(tempC)) doc["temp_c"] = round(tempC * 10) / 10.0;
  doc["net"] = USE_GSM ? "cellular" : "wifi";
  doc["rssi"] = signalDbm();
  doc["uptime_s"] = millis() / 1000;
  char buf[448];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicState.c_str(), (const uint8_t*)buf, n, true);
  lastStateMs = millis();
  stateDirty = false;
}

void publishAck(const char* id, bool ok, const char* error) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = ok;
  doc["pump"] = pumpOn;
  doc["run_remaining_s"] = runRemainingS();
  doc["auto_mode"] = autoMode;
  if (error) doc["error"] = error; else doc["error"] = nullptr;
  char buf[192];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicAck.c_str(), (const uint8_t*)buf, n, false);
}

// Why the pump may not run right now, or nullptr if it may.
const char* blockedReason() {
  if (sourceEmpty) return "source_empty";
  if (tankFull) return "tank_full";
  return nullptr;
}

// ---------- commands ----------
void onMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  const char* id = doc["id"] | "";
  const char* action = doc["action"] | "";
  Serial.printf("[cmd] %s %s\n", id, action);

  readSensors();  // fresh float readings before deciding
  const char* error = nullptr;

  if (!strcmp(action, "run")) {
    int minutes = doc["minutes"] | 0;
    if (minutes < 1 || minutes > MAX_RUN_MINUTES) error = "bad_minutes";
    else if ((error = blockedReason()) == nullptr) setPump(true, (unsigned long)minutes * 60000UL, "voice");
  } else if (!strcmp(action, "pump_off")) {
    setPump(false);
    autoHoldUntilMs = millis() + AUTO_HOLD_MINUTES * 60000UL;  // don't let auto mode restart it right away
  } else if (!strcmp(action, "set_auto")) {
    autoMode = doc["on"] | false;
    autoHoldUntilMs = millis();
    stateDirty = true;
  } else if (!strcmp(action, "set_rain")) {
    rainForecast = doc["rain"] | false;
    rainSetMs = millis();
    stateDirty = true;
  } else if (strcmp(action, "status") != 0) {
    error = "unknown_action";
  }

  publishAck(id, error == nullptr, error);
  publishState();
}

// ---------- automatic watering + safety (runs with or without network) ----------
void controlLoop() {
  unsigned long now = millis();

  if (rainForecast && now - rainSetMs >= RAIN_HOLD_HOURS * 3600000UL) {
    rainForecast = false;  // forecast is stale; backend refreshes it while online
    stateDirty = true;
  }

  if (pumpOn) {
    if (blockedReason()) {
      Serial.printf("[pump] safety stop: %s\n", blockedReason());
      setPump(false);
    } else if (now - pumpStartedMs >= runDurationMs) {
      Serial.println("[pump] timer ended");
      setPump(false);
    } else if (!strcmp(startedBy, "auto") && moisturePct >= TARGET) {
      Serial.println("[pump] target moisture reached");
      setPump(false);
    }
  } else if (autoMode && !rainForecast && autoHoldS() == 0 && !blockedReason() && moisturePct < DRY_LIMIT) {
    setPump(true, AUTO_RUN_MINUTES * 60000UL, "auto");
  }
}

// ---------- connectivity ----------
void networkBegin() {
#if USE_GSM
  #if MODEM_PWRKEY_PIN >= 0
    pinMode(MODEM_PWRKEY_PIN, OUTPUT);
    digitalWrite(MODEM_PWRKEY_PIN, LOW);
    delay(100);
    digitalWrite(MODEM_PWRKEY_PIN, HIGH);
    delay(1000);
    digitalWrite(MODEM_PWRKEY_PIN, LOW);
  #endif
  SerialAT.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(3000);
  Serial.println("[gsm] restarting modem...");
  modem.restart();
  Serial.printf("[gsm] modem: %s\n", modem.getModemInfo().c_str());
  if (strlen(GSM_SIM_PIN) && modem.getSimStatus() != 3) modem.simUnlock(GSM_SIM_PIN);
#else
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
#endif
}

bool networkUp() {
#if USE_GSM
  if (modem.isGprsConnected()) return true;
  Serial.println("[gsm] waiting for network...");
  if (!modem.waitForNetwork(15000L)) return false;
  Serial.println("[gsm] connecting data (APN " GSM_APN ")...");
  return modem.gprsConnect(GSM_APN, GSM_USER, GSM_PASS);
#else
  return WiFi.status() == WL_CONNECTED;
#endif
}

void ensureMqtt() {
  if (mqtt.connected()) return;
  digitalWrite(STATUS_LED_PIN, LOW);
  if (millis() - lastReconnectMs < 10000) return;
  lastReconnectMs = millis();
  if (!networkUp()) return;

  String clientId = String("esp32-") + DEVICE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.printf("[mqtt] connecting to %s:%d...\n", MQTT_HOST, MQTT_PORT);
  bool ok = mqtt.connect(clientId.c_str(),
                         strlen(MQTT_USER) ? MQTT_USER : nullptr,
                         strlen(MQTT_PASS) ? MQTT_PASS : nullptr,
                         topicStatus.c_str(), 1, true, "offline");
  if (!ok) {
    Serial.printf("[mqtt] failed, state %d\n", mqtt.state());
    return;
  }
  Serial.println("[mqtt] connected");
  digitalWrite(STATUS_LED_PIN, HIGH);
  mqtt.publish(topicStatus.c_str(), "online", true);
  mqtt.subscribe(topicCmd.c_str(), 1);
  publishState();
}

// ---------- main ----------
void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);  // always start with the pump off
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(TANK_FULL_PIN, INPUT_PULLUP);
  pinMode(SOURCE_EMPTY_PIN, INPUT_PULLUP);
#if DHT_TYPE != 0 && !FAKE_SENSORS
  dht.begin();
#endif
  Serial.printf("\nSolar Smart Irrigation controller, device %s\n", DEVICE_ID);

  networkBegin();
#if MQTT_TLS && !USE_GSM
  netClient.setInsecure();
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  readSensors();
}

void loop() {
  ensureMqtt();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastSensorMs >= 2000) {
    lastSensorMs = now;
    readSensors();
    controlLoop();
  }

  if (mqtt.connected() && (stateDirty || now - lastStateMs >= STATE_INTERVAL_MS)) publishState();
}
