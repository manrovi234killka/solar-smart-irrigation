// ===== Solar Smart Irrigation controller: settings =====
// Edit this file before uploading. Values the backend must match are marked (MATCH).
#pragma once

// ---------- Network: pick ONE ----------
// 0 = Wi-Fi, 1 = cellular modem (SIM800L 2G or SIM7600 4G) for farms without Wi-Fi
#define USE_GSM 0

// Wi-Fi (used when USE_GSM is 0)
#define WIFI_SSID     "YourWiFiName"
#define WIFI_PASSWORD "YourWiFiPassword"

// Cellular (used when USE_GSM is 1)
#define GSM_MODEM_SIM800             // SIM800L (2G). Use GSM_MODEM_SIM7600 for a 4G SIM7600 board
#define GSM_APN       "airtelgprs.com" // your SIM's APN: airtelgprs.com, bsnlnet, www (Vi), jionet (4G only)
#define GSM_USER      ""
#define GSM_PASS      ""
#define GSM_SIM_PIN   ""
#define MODEM_RX_PIN  16  // ESP32 pin wired to the modem's TX
#define MODEM_TX_PIN  17  // ESP32 pin wired to the modem's RX
#define MODEM_PWRKEY_PIN -1 // pin wired to PWRKEY if your board needs a power-on pulse, else -1
#define MODEM_BAUD    9600  // SIM800L default; SIM7600 boards usually 115200

// ---------- MQTT broker (MATCH backend .env) ----------
// Public test broker by default. For a private broker (e.g. HiveMQ Cloud free tier) set MQTT_TLS 1,
// MQTT_PORT 8883, and the username/password; the backend then uses MQTT_URL=mqtts://<host>:8883.
#define MQTT_HOST     "broker.hivemq.com"
#define MQTT_PORT     1883
#define MQTT_TLS      0         // 1 = encrypted connection (server certificate is not verified)
#define MQTT_USER     ""
#define MQTT_PASS     ""
#define MQTT_TOPIC_PREFIX "solarirrigation"
#define DEVICE_ID     "farm1"   // make it unique, e.g. "farm-ravi-7k3q"

// ---------- Pins (same as the build guide in README.md) ----------
#define SOIL_PIN         34   // capacitive soil sensor AOUT
#define RELAY_PIN        26   // relay IN
#define TANK_FULL_PIN    27   // tank-full float switch to GND (internal pull-up)
#define SOURCE_EMPTY_PIN 25   // source-empty float switch to GND (internal pull-up)
#define BATTERY_PIN      32   // battery voltage divider midpoint (optional)
#define SOLAR_PIN        33   // solar panel voltage divider midpoint (optional)
#define DHT_PIN          4    // DHT22/DHT11 data (optional)
#define STATUS_LED_PIN   2    // on-board LED: on = connected to the broker

#define RELAY_ACTIVE_LOW 1    // 1 if the relay clicks ON when IN is LOW (most blue relay boards)

// ---------- Sensors ----------
// 1 = generate realistic fake readings (demo with only the relay wired). 0 = read the real sensors.
#define FAKE_SENSORS   0

#define USE_FLOATS     1      // 0 if the float switches are not wired yet (treated as "OK")
#define DHT_TYPE       22     // 0 = no temperature sensor, 11 = DHT11, 22 = DHT22
#define USE_VOLTAGE_SENSE 1   // 0 if the battery/solar dividers are not wired

// Soil sensor calibration: raw reading in dry air (0 %) and in a glass of water (100 %)
#define SOIL_DRY_RAW   3200
#define SOIL_WET_RAW   1300

// Voltage dividers: (R_top + R_bottom) / R_bottom. 100k/22k for a 12 V battery, 100k/15k for a ~22 V panel.
#define BATTERY_DIVIDER ((100.0 + 22.0) / 22.0)
#define SOLAR_DIVIDER   ((100.0 + 15.0) / 15.0)

// ---------- Automatic watering (set per crop) ----------
#define AUTO_MODE_DEFAULT 1   // auto mode on at boot
#define DRY_LIMIT         35  // % : auto mode starts watering below this
#define TARGET            70  // % : auto run stops at this level
#define AUTO_RUN_MINUTES  20  // every auto run also ends on this timer
#define AUTO_HOLD_MINUTES 60  // after a manual stop, auto mode waits this long before watering again
#define RAIN_HOLD_HOURS   12  // a rain forecast from the backend skips auto watering for this long

// ---------- Safety ----------
#define MAX_RUN_MINUTES   60  // longest manual run accepted (MATCH backend MAX_RUN_MINUTES)
#define STATE_INTERVAL_MS 10000 // how often readings are published
