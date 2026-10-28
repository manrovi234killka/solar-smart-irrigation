// ===== Solar irrigation controller: settings =====
// Edit this file before uploading. Everything the backend needs to match is marked (MATCH).
#pragma once

// ---------- Network: pick ONE ----------
// 0 = Wi-Fi, 1 = cellular modem (SIM7600 4G or SIM800L 2G) for farms without Wi-Fi
#define USE_GSM 0

// Wi-Fi (used when USE_GSM is 0)
#define WIFI_SSID     "YourWiFiName"
#define WIFI_PASSWORD "YourWiFiPassword"

// Cellular (used when USE_GSM is 1)
#define GSM_MODEM_SIM7600          // or GSM_MODEM_SIM800 for a SIM800L
#define GSM_APN       "airtelgprs.com" // your SIM's APN, e.g. jionet, airtelgprs.com, bsnlnet, www (Vi)
#define GSM_USER      ""
#define GSM_PASS      ""
#define GSM_SIM_PIN   ""
#define MODEM_RX_PIN  16  // ESP32 pin wired to the modem's TX
#define MODEM_TX_PIN  17  // ESP32 pin wired to the modem's RX
#define MODEM_PWRKEY_PIN -1 // set to the pin wired to PWRKEY if your board needs a power-on pulse, else -1
#define MODEM_BAUD    115200 // SIM800L boards are often 9600

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

// ---------- Pins ----------
#define RELAY_PIN      26
#define RELAY_ACTIVE_LOW 1      // most blue relay modules switch ON when the input is LOW
#define SOIL_PIN       34       // capacitive soil moisture sensor, analog out
#define WATER_PIN      35       // analog water level sensor (or float switch, see WATER_FLOAT_SWITCH)
#define BATTERY_PIN    32       // battery voltage divider midpoint
#define SOLAR_PIN      33       // solar panel voltage divider midpoint
#define DHT_PIN        27       // DHT11/DHT22 data pin
#define STATUS_LED_PIN 2        // on-board LED: on = connected to the broker

// ---------- Sensors ----------
// 1 = generate realistic fake readings (demo with only the relay wired). 0 = read the real sensors.
#define FAKE_SENSORS   0

// Temperature sensor: 0 = none, 11 = DHT11, 22 = DHT22
#define DHT_TYPE       11

// Soil sensor calibration: raw ADC reading in dry air and in a glass of water
#define SOIL_DRY_RAW   3000
#define SOIL_WET_RAW   1300

// Water level: analog sensor raw readings for empty and full. Set WATER_FLOAT_SWITCH 1 for a float switch
// (pin reads LOW when water is above the switch -> reported as 100%, else 0%).
#define WATER_FLOAT_SWITCH 0
#define WATER_EMPTY_RAW 0
#define WATER_FULL_RAW  2000

// Voltage dividers: (R_top + R_bottom) / R_bottom. 100k/22k for a 12 V battery, 100k/15k for a ~22 V panel.
#define BATTERY_DIVIDER ((100.0 + 22.0) / 22.0)
#define SOLAR_DIVIDER   ((100.0 + 15.0) / 15.0)

// ---------- Safety ----------
#define MIN_WATER_PCT       15   // refuse to start / stop the pump below this tank level (dry-run protection)
#define MAX_ON_MINUTES      120  // an untimed "pump on" switches itself off after this long
#define MAX_RUN_MINUTES     120  // longest timed run accepted
#define STATE_INTERVAL_MS   10000 // how often readings are published
