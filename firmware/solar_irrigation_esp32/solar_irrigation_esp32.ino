// Solar irrigation pump controller for ESP32.
// Receives pump commands from the phone-call voice assistant over MQTT and reports sensor readings.
// Network: Wi-Fi, or a SIM7600/SIM800L cellular modem (set USE_GSM in config.h).
//
// MQTT topics (base = MQTT_TOPIC_PREFIX/DEVICE_ID):
//   base/cmd     <- {"id":"ab12","action":"pump_on"|"pump_off"|"run"|"status","minutes":10}
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
  #if defined(GSM_MODEM_SIM800)
    #define TINY_GSM_MODEM_SIM800
  #else
    #define TINY_GSM_MODEM_SIM7600
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

// ---------- pump state ----------
bool pumpOn = false;
unsigned long pumpStartedMs = 0;
unsigned long runDurationMs = 0;  // 0 = untimed (limited by MAX_ON_MINUTES)

// ---------- latest readings ----------
float moisturePct = 0, waterPct = 0, batteryV = 0, solarV = 0, tempC = NAN;

unsigned long lastStateMs = 0, lastSensorMs = 0, lastReconnectMs = 0;
bool stateDirty = true;

void setRelay(bool on) {
  digitalWrite(RELAY_PIN, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
}

void setPump(bool on, unsigned long durationMs = 0) {
  pumpOn = on;
  pumpStartedMs = millis();
  runDurationMs = on ? durationMs : 0;
  setRelay(on);
  stateDirty = true;
  Serial.printf("[pump] %s%s\n", on ? "ON" : "OFF",
                on && durationMs ? (" for " + String(durationMs / 60000) + " min").c_str() : "");
}

long runRemainingS() {
  if (!pumpOn || runDurationMs == 0) return 0;
  unsigned long elapsed = millis() - pumpStartedMs;
  return elapsed >= runDurationMs ? 0 : (runDurationMs - elapsed) / 1000;
}

// ---------- sensors ----------
float clampPct(float v) { return v < 0 ? 0 : (v > 100 ? 100 : v); }

void readSensors() {
#if FAKE_SENSORS
  // Plausible demo values: soil gets wetter and the tank drains while the pump runs.
  static bool init = false;
  if (!init) { moisturePct = 31; waterPct = 82; init = true; }
  moisturePct = clampPct(moisturePct + (pumpOn ? 0.4 : -0.02));
  waterPct = clampPct(waterPct - (pumpOn ? 0.1 : -0.01));
  batteryV = 12.4 + random(-10, 10) / 100.0;
  solarV = 18.5 + random(-50, 50) / 100.0;
  tempC = 30.5 + random(-10, 10) / 10.0;
#else
  int soilRaw = analogRead(SOIL_PIN);
  moisturePct = clampPct(100.0 * (SOIL_DRY_RAW - soilRaw) / (SOIL_DRY_RAW - SOIL_WET_RAW));
  #if WATER_FLOAT_SWITCH
    waterPct = digitalRead(WATER_PIN) == LOW ? 100 : 0;
  #else
    int waterRaw = analogRead(WATER_PIN);
    waterPct = clampPct(100.0 * (waterRaw - WATER_EMPTY_RAW) / (WATER_FULL_RAW - WATER_EMPTY_RAW));
  #endif
  batteryV = analogReadMilliVolts(BATTERY_PIN) / 1000.0 * BATTERY_DIVIDER;
  solarV = analogReadMilliVolts(SOLAR_PIN) / 1000.0 * SOLAR_DIVIDER;
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
  doc["moisture_pct"] = (int)round(moisturePct);
  doc["water_level_pct"] = (int)round(waterPct);
  doc["battery_v"] = round(batteryV * 10) / 10.0;
  doc["solar_v"] = round(solarV * 10) / 10.0;
  if (isnan(tempC)) doc["temp_c"] = nullptr; else doc["temp_c"] = round(tempC * 10) / 10.0;
  doc["net"] = USE_GSM ? "cellular" : "wifi";
  doc["rssi"] = signalDbm();
  doc["uptime_s"] = millis() / 1000;
  char buf[320];
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
  if (error) doc["error"] = error; else doc["error"] = nullptr;
  char buf[160];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicAck.c_str(), (const uint8_t*)buf, n, false);
}

// ---------- commands ----------
void onMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  const char* id = doc["id"] | "";
  const char* action = doc["action"] | "";
  Serial.printf("[cmd] %s %s\n", id, action);

  readSensors();  // fresh tank level before deciding
  const char* error = nullptr;

  if (!strcmp(action, "pump_on") || !strcmp(action, "run")) {
    if (waterPct < MIN_WATER_PCT) {
      error = "water_low";
    } else if (!strcmp(action, "run")) {
      int minutes = doc["minutes"] | 0;
      if (minutes < 1 || minutes > MAX_RUN_MINUTES) error = "bad_minutes";
      else setPump(true, (unsigned long)minutes * 60000UL);
    } else {
      setPump(true);
    }
  } else if (!strcmp(action, "pump_off")) {
    setPump(false);
  } else if (strcmp(action, "status") != 0) {
    error = "unknown_action";
  }

  publishAck(id, error == nullptr, error);
  publishState();
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
  if (!modem.waitForNetwork(30000L)) return false;
  Serial.println("[gsm] connecting data (APN " GSM_APN ")...");
  return modem.gprsConnect(GSM_APN, GSM_USER, GSM_PASS);
#else
  return WiFi.status() == WL_CONNECTED;
#endif
}

void ensureMqtt() {
  if (mqtt.connected()) return;
  digitalWrite(STATUS_LED_PIN, LOW);
  if (millis() - lastReconnectMs < 5000) return;
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
  setRelay(false);  // pump off at boot, before anything else
  pinMode(STATUS_LED_PIN, OUTPUT);
#if WATER_FLOAT_SWITCH
  pinMode(WATER_PIN, INPUT_PULLUP);
#endif
#if DHT_TYPE != 0 && !FAKE_SENSORS
  dht.begin();
#endif
  Serial.printf("\nSolar irrigation controller, device %s\n", DEVICE_ID);

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
  }

  // Safety and timers keep working even when the network is down.
  if (pumpOn) {
    unsigned long elapsed = now - pumpStartedMs;
    if (runDurationMs && elapsed >= runDurationMs) {
      Serial.println("[pump] timed run finished");
      setPump(false);
    } else if (!runDurationMs && elapsed >= MAX_ON_MINUTES * 60000UL) {
      Serial.println("[pump] max on-time reached");
      setPump(false);
    } else if (waterPct < MIN_WATER_PCT) {
      Serial.println("[pump] tank low, stopping (dry-run protection)");
      setPump(false);
    }
  }

  if (mqtt.connected() && (stateDirty || now - lastStateMs >= STATE_INTERVAL_MS)) publishState();
}
