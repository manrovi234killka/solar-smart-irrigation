# Solar Smart Irrigation: Phone-Call Voice Assistant

A farmer dials an ordinary phone number and says things like *"turn the pump on"*, *"run the pump for 10 minutes"* or *"what's the soil moisture?"*, in **English, Hindi, Telugu, Tamil or Kannada**. The assistant understands, switches the pump on the solar-powered ESP32 controller, and answers by voice.

The farmer needs no smartphone, no app and no internet: any basic phone works.

```
 Farmer's phone ──call──▶ Twilio number ──webhook──▶ Backend (Node.js) ──MQTT──▶ ESP32 ──▶ relay ──▶ pump
                 ◀─voice── speech-to-text,          Claude decides which        Wi-Fi or      sensors: soil,
                           text-to-speech           tool to call                SIM7600/800   tank, battery,
                                                                                4G/2G         solar, temperature
```

| Part | What it does |
|---|---|
| **Twilio Programmable Voice** | Phone number, keypad language menu, speech recognition (`<Gather input="speech">`), spoken replies (`<Say>`) |
| **Claude (`claude-opus-5-5`)** | Understands the request in any of the 5 languages and calls tools: `get_farm_status`, `set_pump`, `run_pump_for_minutes`, `end_call` |
| **MQTT broker** | Delivers commands to the ESP32 and readings back. The public HiveMQ broker works out of the box |
| **ESP32 firmware** | Drives the pump relay, reads sensors, runs timed runs locally, and has dry-run protection, a max on-time and a boot-off failsafe |

## Folder layout

```
backend/                 Node.js server (Twilio webhooks, Claude agent, MQTT link, test dashboard)
  src/server.js          call flow + /api test endpoints
  src/agent.js           Claude tool-use loop (plus a keyword fallback with no AI)
  src/device.js          MQTT link to the ESP32, plus a built-in simulated ESP32
  src/languages.js       language menu, voices and fixed phrases for en/hi/te/ta/kn
  scripts/smoke-test.js  plays a whole call through the webhooks (npm test)
  scripts/fake-esp32.js  pretend ESP32 speaking the real MQTT protocol
  scripts/chat.js        type to the assistant from the terminal
  public/index.html      live dashboard + text chat (http://localhost:3000)
firmware/solar_irrigation_esp32/
  solar_irrigation_esp32.ino   ESP32 sketch
  config.h                     Wi-Fi/SIM, broker, pins, calibration, safety limits
```

---

## 1. Run the backend locally (10 minutes, no hardware)

Needs Node.js 20 or newer.

```bash
cd backend
npm install
copy .env.example .env
npm test
```

`npm test` starts the server with the simulated ESP32 and the keyword agent, then plays a call through the Twilio webhooks: language menu, timed run, pump off, moisture question, silence, language switch, hang-up. Every check should print `PASS`.

Now add Claude. Create an API key at <https://platform.claude.com>, put it in `backend/.env` as `ANTHROPIC_API_KEY=...`, then:

```bash
npm start
```

Open <http://localhost:3000> to see the live readings tiles and a text box. Try *"run the pump for 10 minutes"*, *"is the soil dry?"* or *"पंप बंद करो"*. Or chat in a second terminal:

```bash
npm run chat -- te
```

Useful `.env` settings (all listed in `.env.example`):

| Setting | Meaning |
|---|---|
| `SIMULATOR=true` | Built-in fake ESP32. Set it to `false` once the real ESP32 (or `npm run fake-esp32`) is connected |
| `AI_EFFORT=low` | How hard Claude thinks. `low` keeps phone replies fast; try `medium` if answers seem careless |
| `AI_MODE=rules` | Keyword matching with no AI. A backup if the venue internet is too slow for the API (replies in English only) |
| `ALLOWED_CALLERS` | Comma-separated phone numbers allowed to control the pump, for example `+919876543210` |
| `API_TOKEN` | Protects `/api/*` and the dashboard (`http://.../?token=...`) once the server is on the internet |

The Claude requests also enable Anthropic's server-side refusal fallback (`fallbacks: "default"`), so a rare declined request is retried on another model instead of failing the call.

---

## 2. Connect a real phone number (Twilio)

1. **Make the backend reachable from the internet** with ngrok:
   ```bash
   winget install ngrok.ngrok
   ngrok config add-authtoken <token from dashboard.ngrok.com>
   ngrok http 3000
   ```
   Copy the `https://....ngrok-free.app` address into `PUBLIC_URL` in `.env` and restart `npm start`.
2. **Create a Twilio account** at <https://www.twilio.com/try-twilio> and get a phone number with **Voice** capability (Console → Phone Numbers → Buy a number).
   - A **trial** account plays a short trial message first and only accepts calls from phone numbers you have verified (Console → Phone Numbers → Verified Caller IDs). Verify the phones you will demo with.
   - Indian (+91) Twilio numbers need regulatory documents and can take days to approve. For the hackathon, a US/UK number called from a verified phone is fastest. For real farmers, an Indian number or a local telephony provider avoids international call charges.
3. **Point the number at the backend**: Console → Phone Numbers → *your number* → Voice Configuration:
   - *A call comes in*: **Webhook**, `https://<your-ngrok>/voice/incoming`, **HTTP POST**
   - *Call status changes*: `https://<your-ngrok>/voice/status`
4. Copy your **Auth Token** (Console home page) into `TWILIO_AUTH_TOKEN` in `.env`. The server then rejects webhook calls that are not signed by Twilio. `PUBLIC_URL` must match the ngrok address exactly for this check to pass.
5. Call the number. A first-time caller hears the language menu (1 English, 2 Hindi, 3 Telugu, 4 Tamil, 5 Kannada). The choice is remembered for that phone number, and pressing 1–5 at any time during a call switches language.

**Voices:** the defaults are Twilio's Google voices (`Google.hi-IN-Standard-A` and so on). If Twilio reports an invalid voice, pick another from Console → Voice → Text-to-speech and set `VOICE_EN`, `VOICE_HI`, `VOICE_TE`, `VOICE_TA` or `VOICE_KN` in `.env`.

**Slow replies:** if Claude takes longer than about 9 s, the caller hears "One moment" and the answer follows, so Twilio's 15-second webhook limit is never hit.

---

## 3. Build the ESP32 controller

### Arduino IDE setup

1. Arduino IDE 2 → File → Preferences → *Additional boards manager URLs*: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. Boards Manager → install **esp32 by Espressif Systems**. Select board **ESP32 Dev Module**.
3. Library Manager → install **PubSubClient** (Nick O'Leary), **ArduinoJson** (v7), **DHT sensor library** (Adafruit, accept *Install all* for Adafruit Unified Sensor), and **TinyGSM** (only needed for the SIM module).
4. Open `firmware/solar_irrigation_esp32/solar_irrigation_esp32.ino` and edit `config.h`:
   - `WIFI_SSID` / `WIFI_PASSWORD`, or set `USE_GSM 1` and your SIM's `GSM_APN`
   - `DEVICE_ID`: something unique like `farm-ravi-7k3q`, and **the same value in `backend/.env`**
   - `FAKE_SENSORS 1` if you only have the relay wired (the readings are then realistic made-up values, fine for a demo)
5. Upload, then open Serial Monitor at 115200 baud. You should see `[mqtt] connected`.
6. In `backend/.env` set `SIMULATOR=false` and restart. The dashboard tiles now show the ESP32's readings and *Controller: online · wifi*.

### Wiring

| ESP32 pin | Connects to | Notes |
|---|---|---|
| GPIO 26 | Relay module IN | Relay VCC to 5V (VIN), GND to GND. `RELAY_ACTIVE_LOW 1` suits most blue relay boards |
| GPIO 34 | Capacitive soil moisture sensor AOUT | Sensor VCC 3.3V. Calibrate `SOIL_DRY_RAW` (in air) and `SOIL_WET_RAW` (in water) |
| GPIO 35 | Water level sensor signal (analog), or float switch to GND | For a float switch set `WATER_FLOAT_SWITCH 1` and add a 10k pull-up to 3.3V (GPIO 35 has no internal pull-up) |
| GPIO 32 | Battery divider midpoint | 100k from battery + to pin, 22k from pin to GND (12 V battery → about 2.2 V) |
| GPIO 33 | Solar panel divider midpoint | 100k from panel + to pin, 15k from pin to GND (22 V open circuit → about 2.9 V) |
| GPIO 27 | DHT11/DHT22 data | 10k pull-up to 3.3V if your module lacks one. Set `DHT_TYPE` |
| GPIO 16 / 17 | SIM7600/SIM800L TX / RX | Only with `USE_GSM 1`. The modem needs its own supply (see below) |
| GPIO 2 | On-board LED | Lit while connected to the broker |

**Power and safety**

- Power the ESP32 from the solar battery through a 5 V buck converter into VIN, not straight from 12 V.
- Analog pins must never see more than 3.3 V. Measure each divider output with a multimeter before connecting it.
- The relay contacts switch the **pump's** supply. A small 12 V DC pump can go through the relay directly. For an AC or high-current motor, the relay should drive a properly rated contactor, wired by someone qualified for mains work.
- SIM7600 and SIM800L modules draw up to 2 A in bursts. Give them their own buck converter (about 4.0 V for SIM800L, or what your SIM7600 board specifies) with a large capacitor (≥1000 µF) near the module, and share GND with the ESP32. Powering them from the ESP32's 3.3 V pin causes endless resets.
- Use only ADC1 pins (32–39) for analog sensors; ADC2 pins stop working while Wi-Fi is on.

### Built-in protections (they work even with no network)

- The pump is forced **off at boot**.
- A **timed run** stops itself on the ESP32's own clock, even if the phone line, server or internet drops.
- **Dry-run protection**: refuses to start, or stops, when the tank is below `MIN_WATER_PCT`. The assistant explains this to the caller.
- An **untimed "on"** stops after `MAX_ON_MINUTES`.
- If the ESP32 loses power or network, the broker publishes `offline` and the assistant tells the caller the controller is offline.

### Farms without Wi-Fi

Set `USE_GSM 1`, choose `GSM_MODEM_SIM7600` (4G) or `GSM_MODEM_SIM800` (2G; check that 2G still works in your area), set the APN for the SIM (for example `jionet`, `airtelgprs.com`, `bsnlnet`, or `www` for Vi), and use a SIM with a small data pack. MQTT uses very little data: a few MB a month at the default 10-second reporting interval.

---

## 4. Test plan

Run these in order. Each row says what to do and what should happen.

### A. Backend only (no phone, no hardware)

| # | Do | Expect |
|---|---|---|
| A1 | `npm test` | All 10 checks `PASS` |
| A2 | `npm start` with the API key set; dashboard → *"what's the status?"* | Spoken-style reply with real numbers from the simulator; console shows `[agent] get_farm_status` |
| A3 | Dashboard → *"run the pump for 2 minutes"* | Pump tile shows *ON (2 min left)*; it turns OFF by itself after 2 minutes |
| A4 | Dashboard, Hindi selected → *"पंप चालू करो"* | Reply in Hindi (Devanagari); pump ON |
| A5 | Repeat A4 in Telugu, Tamil and Kannada | Replies in each language's script |
| A6 | Add `SIM_MIN_WATER_PCT=90` to `.env` (simulated tank is about 78% full), restart, ask to turn the pump on | Refused; the assistant explains the tank is too low |

### B. MQTT link (still no hardware)

| # | Do | Expect |
|---|---|---|
| B1 | `.env`: `SIMULATOR=false` and a unique `DEVICE_ID`. Terminal 1: `npm run fake-esp32`. Terminal 2: `npm start` | Server log `[mqtt] connected`; dashboard *Controller: online · fake-esp32* |
| B2 | *"pump on for 5 minutes"* | fake-esp32 logs the `run` command; dashboard shows ON |
| B3 | Stop fake-esp32 (Ctrl+C), wait about 1 minute, ask for the status | Assistant says the controller is offline |

### C. ESP32 on the bench

| # | Do | Expect |
|---|---|---|
| C1 | Upload with `FAKE_SENSORS 1`, only the relay wired | Serial shows `[mqtt] connected`; LED on; dashboard online · wifi |
| C2 | Dashboard → *"turn the pump on"*, then *"off"* | Relay clicks on, then off; Serial shows `[cmd]` and `[pump]` lines |
| C3 | *"run the pump for 1 minute"*, then unplug the router | Relay still clicks off after 1 minute |
| C4 | Wire the real sensors, `FAKE_SENSORS 0`; dip the soil probe in water | Soil moisture rises toward 100% within 10 seconds |
| C5 | Lower the tank below `MIN_WATER_PCT` (or lift the float) while the pump runs | Pump stops; Serial says `dry-run protection` |
| C6 | Reset the ESP32 while the pump is on | Pump stays OFF after reboot |

### D. Real phone call

| # | Do | Expect |
|---|---|---|
| D1 | Call the Twilio number from a verified phone | Language menu in 5 languages |
| D2 | Press 1, say *"what's the soil moisture?"* | Spoken answer with the percentage within a few seconds |
| D3 | *"Run the pump for 10 minutes"* | Relay on; spoken confirmation; turns off after 10 minutes |
| D4 | Stay silent twice | "Sorry, I did not hear you"; after the third silence the call ends politely |
| D5 | Press 3 during the call, say *"పంపు ఆపు"* (stop the pump) | Switches to Telugu; pump OFF; reply in Telugu |
| D6 | Hang up and call again | Menu skipped; greeted in Telugu |
| D7 | *"Thank you, bye"* | Goodbye, call ends |
| D8 | With `ALLOWED_CALLERS` set, call from another phone | "This number is not registered", then hang-up |

### Demo script for the video (about 60 seconds)

1. Show the farm setup and the dashboard side by side.
2. Call from a basic phone and pick Hindi or Telugu.
3. *"What's the soil moisture?"*: the assistant reads it out and says the field is dry.
4. *"Run the pump for 10 minutes"*: the relay clicks and the pump starts; the dashboard shows the countdown.
5. *"Battery and solar?"*: it reads out the voltages.
6. *"Stop the pump"*, then *"thank you"*: the pump stops and the call ends.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Call says "an application error has occurred" | Check the ngrok window for the request. Make sure the webhook is `.../voice/incoming` with **POST** and `npm start` is running. A `403` means `PUBLIC_URL` doesn't match the ngrok address; fix it, or set `VALIDATE_TWILIO=false` while testing |
| Assistant always says the controller is offline | `DEVICE_ID`, `MQTT_TOPIC_PREFIX` and the broker must match in `config.h` and `.env`. Check Serial Monitor for `[mqtt] connected` |
| Speech not recognised well | Speak after the prompt ends. Mixed words like "pump on" work in every language. Check the server log line `heard: "..."` to see what Twilio transcribed |
| SIM module keeps restarting | Power supply: see the power notes above |
| `ANTHROPIC_API_KEY is not set` in the log | Put the key in `backend/.env`; until then the keyword fallback answers |

## Security notes

- The public HiveMQ broker is shared by everyone. Anyone who guesses your `DEVICE_ID` could send commands, so use a long, random ID. For a real deployment, use a private broker with a username and password (HiveMQ Cloud has a free tier): set `MQTT_TLS 1`, port 8883 and the credentials in `config.h`, and `MQTT_URL=mqtts://<host>:8883` plus `MQTT_USERNAME` and `MQTT_PASSWORD` in `.env`.
- Set `ALLOWED_CALLERS` so only the farmer's phones can control the pump, and `API_TOKEN` before exposing the dashboard.
- Keep `.env` out of git (it is in `.gitignore`).
