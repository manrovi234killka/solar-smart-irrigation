# Voice assistant and controller: setup and test guide

This guide covers the working software: the phone-call and SMS assistant in `backend/` and the ESP32 controller in `firmware/solar_irrigation_esp32/`. The project overview, parts list and build steps are in the main [README](../README.md).

```
 Farmer's phone ──call / SMS──▶ Twilio number ──webhook──▶ Backend (Node.js) ──MQTT──▶ ESP32 ──▶ relay ──▶ pump
                 ◀──voice / SMS── speech-to-text,          Claude picks a tool,        Wi-Fi or      soil sensor,
                                  text-to-speech           reads it back, waits        SIM800L/      floats, battery,
                                                           for "yes"                   SIM7600       solar, DHT22
```

| Part | What it does |
|---|---|
| **Twilio** | Phone number, keypad language menu, speech recognition and spoken replies; the same number can take SMS |
| **Claude (`claude-opus-5-5`)** | Understands English, Hindi, Telugu, Tamil and Kannada and calls tools: `get_farm_status`, `start_pump`, `stop_pump`, `set_auto_mode`, `get_weather_forecast`, `end_call` |
| **Read-back rule** | Every pump start (and turning auto mode on) is read back, and runs only after the farmer's next reply is a clear yes. This is enforced in `backend/src/agent.js`, not only in the prompt. Stopping is always immediate |
| **Open-Meteo** | Free forecast, no key needed. Answers weather questions and tells the ESP32 to skip auto watering when rain is expected. The forecast never starts the pump |
| **MQTT broker** | Carries commands to the ESP32 and readings back. The public HiveMQ broker works out of the box |
| **ESP32 firmware** | Auto mode (dry limit to target), a timer on every run, tank-full and source-empty float cut-offs, pump off at boot. All of this keeps working with no network |

## 1. Run the backend locally (10 minutes, no hardware)

Needs Node.js 20 or newer.

```bash
cd backend
npm install
copy .env.example .env
npm test
```

`npm test` starts the server with a simulated ESP32 and the keyword agent, then plays a whole call through the Twilio webhooks: language menu, read-back, yes, stop, a no, an SMS, a moisture question, silence, a language switch and the hang-up. All 12 checks should print `PASS`.

Now add Claude. Create an API key at <https://platform.claude.com>, put it in `backend/.env` as `ANTHROPIC_API_KEY=...`, set `FARM_LAT` and `FARM_LON` to the farm's location, then:

```bash
npm start
```

Open <http://localhost:3000> for live tiles (pump, moisture, auto mode, floats, battery, solar) and a text box that talks to the same assistant. Try *"run the pump for 10 minutes"* and then *"yes"*, *"will it rain tomorrow?"*, or *"पंप बंद करो"* (Hindi for "turn the pump off"). Or chat in a terminal:

```bash
npm run chat -- te
```

Useful `.env` settings (all listed in `.env.example`):

| Setting | Meaning |
|---|---|
| `SIMULATOR=true` | Built-in fake ESP32 that follows the firmware's rules. Set `false` once the real ESP32 (or `npm run fake-esp32`) is connected |
| `AI_EFFORT=low` | How hard Claude thinks. `low` keeps phone replies fast; try `medium` if answers seem careless |
| `AI_MODE=rules` | Keyword matching with no AI: a backup if the venue internet is too slow (replies in English, same read-back rule) |
| `DEFAULT_RUN_MINUTES` / `MAX_RUN_MINUTES` | Run time when none is given (20) and the longest allowed (60; match the firmware) |
| `FARM_LAT` / `FARM_LON` | Enables forecasts and the rain skip |
| `ALLOWED_CALLERS` | Comma-separated phone numbers allowed to control the pump, for example `+919876543210` |
| `API_TOKEN` | Protects `/api/*` and the dashboard (`http://.../?token=...`) once the server is on the internet |

The Claude requests also enable Anthropic's server-side refusal fallback (`fallbacks: "default"`), so a rare declined request is retried on another model instead of failing the call.

## 2. Connect a real phone number (Twilio)

1. **Make the backend reachable from the internet** with ngrok:
   ```bash
   winget install ngrok.ngrok
   ngrok config add-authtoken <token from dashboard.ngrok.com>
   ngrok http 3000
   ```
   Copy the `https://....ngrok-free.app` address into `PUBLIC_URL` in `.env` and restart `npm start`.
2. **Create a Twilio account** at <https://www.twilio.com/try-twilio> and get a number with **Voice** (and **SMS** if you want text commands).
   - A **trial** account plays a short trial message first and only accepts calls and SMS from numbers you have verified (Console → Phone Numbers → Verified Caller IDs). Verify the phones you will demo with.
   - Indian (+91) Twilio numbers need regulatory documents and can take days. For the hackathon, a US/UK number called from a verified phone is fastest. For real farmers, an Indian number or a local telephony provider avoids international call charges.
3. **Point the number at the backend**: Console → Phone Numbers → *your number*:
   - Voice, *A call comes in*: **Webhook** `https://<your-ngrok>/voice/incoming`, **HTTP POST**
   - Voice, *Call status changes*: `https://<your-ngrok>/voice/status`
   - Messaging, *A message comes in*: `https://<your-ngrok>/sms`, **HTTP POST**
4. Copy your **Auth Token** into `TWILIO_AUTH_TOKEN` in `.env`. The server then rejects webhook requests not signed by Twilio. `PUBLIC_URL` must match the ngrok address exactly for this check to pass.
5. Call the number. A first-time caller hears the language menu (1 English, 2 Hindi, 3 Telugu, 4 Tamil, 5 Kannada). The choice is remembered for that phone number, and pressing 1–5 during a call switches language. SMS replies come in the language the farmer writes in.

**Voices:** the defaults are Twilio's Google voices (`Google.te-IN-Standard-A` and so on). If Twilio reports an invalid voice, pick another under Console → Voice → Text-to-speech and set `VOICE_EN`, `VOICE_HI`, `VOICE_TE`, `VOICE_TA` or `VOICE_KN`.

**Slow replies:** if Claude takes longer than about 9 s, the caller hears "One moment" and then the answer, so Twilio's 15-second webhook limit is never hit.

## 3. Flash the ESP32

1. Arduino IDE 2 → File → Preferences → *Additional boards manager URLs*: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. Boards Manager → install **esp32 by Espressif Systems**. Board: **ESP32 Dev Module**.
3. Library Manager → **PubSubClient** (Nick O'Leary), **ArduinoJson** (v7), **DHT sensor library** (Adafruit; accept *Install all*), **TinyGSM** (for the SIM module).
4. Open `firmware/solar_irrigation_esp32/solar_irrigation_esp32.ino` and edit `config.h`:
   - `WIFI_SSID` / `WIFI_PASSWORD`, or `USE_GSM 1` with your SIM's `GSM_APN`
   - `DEVICE_ID`: something unique like `farm-ravi-7k3q`, and **the same value in `backend/.env`**
   - `SOIL_DRY_RAW` / `SOIL_WET_RAW` from your calibration, and `DRY_LIMIT` / `TARGET` for the crop
   - `FAKE_SENSORS 1` if only the relay is wired (realistic made-up readings for a demo); `USE_FLOATS 0` until the floats are fitted
5. Upload with the pump unplugged and open Serial Monitor at 115200 baud. You should see `[mqtt] connected`.
6. In `backend/.env` set `SIMULATOR=false` and restart. The dashboard shows *Controller: online · wifi*.

### Pins

The first four match the build guide in the main README. The rest are optional extras.

| ESP32 pin | Connects to | Notes |
|---|---|---|
| GPIO34 | Soil sensor AOUT | VCC 3V3. Average of 10 readings |
| GPIO26 | Relay IN | `RELAY_ACTIVE_LOW 1` suits most blue relay boards; set 0 if yours clicks on with HIGH |
| GPIO27 | Tank-full float to GND | Internal pull-up; closed = full, so the pump stops |
| GPIO25 | Source-empty float to GND | Internal pull-up; closed = empty, giving dry-run protection |
| GPIO32 | Battery divider midpoint | 100k from battery + to pin, 22k from pin to GND (12 V → about 2.2 V). `USE_VOLTAGE_SENSE 0` if not fitted |
| GPIO33 | Solar panel divider midpoint | 100k from panel + to pin, 15k from pin to GND (22 V → about 2.9 V) |
| GPIO4 | DHT22 data | 10k pull-up to 3V3 if the module lacks one. `DHT_TYPE 0` if not fitted |
| GPIO16 / 17 | SIM800L TX / RX | Only with `USE_GSM 1`; the modem needs its own supply |
| GPIO2 | On-board LED | Lit while connected to the broker |

Analog pins must never see more than 3.3 V, so measure each divider output before connecting it. SIM800L and SIM7600 modules draw up to 2 A in bursts. Give them their own buck converter (about 4.0 V for SIM800L) with a ≥1000 µF capacitor near the module, and share GND with the ESP32.

### Farms without Wi-Fi

Set `USE_GSM 1`. The default `GSM_MODEM_SIM800` matches the SIM800L in the parts list. It needs a 2G network (Airtel, Vi or BSNL in most areas; Jio has no 2G). Use `GSM_MODEM_SIM7600` for a 4G module. MQTT uses only a few MB a month at the default 10-second interval.

## 4. Test plan

These map onto the six tests in `docs/evaluation_results_template.csv`; record the results there.

### A. Backend only

| # | Do | Expect |
|---|---|---|
| A1 | `npm test` | 12 checks `PASS` |
| A2 | Dashboard: *"what's the status?"* | Reply with the simulator's numbers; log shows `[agent] get_farm_status` |
| A3 | *"run the pump for 2 minutes"* | Read-back question, pump still OFF |
| A4 | *"yes"* | Pump ON · 2 min left; turns OFF by itself after 2 minutes |
| A5 | *"start the pump"*, then *"no"* | Nothing starts |
| A6 | Hindi selected: *"पंप चालू करो"*, then *"हाँ"* | Read-back in Hindi, then ON |
| A7 | Repeat A6 in Telugu, Tamil and Kannada | Replies in each language's script |
| A8 | `SIM_SOURCE_EMPTY=true` in `.env`, restart, start + yes | Refused: the source is empty, dry-run protection |
| A9 | *"will it rain in the next two days?"* (with `FARM_LAT`/`FARM_LON`) | Forecast from Open-Meteo |

### B. MQTT link (no hardware)

| # | Do | Expect |
|---|---|---|
| B1 | `.env`: `SIMULATOR=false`, unique `DEVICE_ID`. Terminal 1: `npm run fake-esp32`. Terminal 2: `npm start` | `[mqtt] connected`; dashboard online · fake-esp32 |
| B2 | *"pump on for 5 minutes"* + *"yes"* | fake-esp32 logs the `run` command; dashboard ON |
| B3 | Stop fake-esp32 and wait about a minute, then ask for the status | Assistant says the controller is offline |

### C. ESP32 on the bench (pump unplugged first, then a 12 V pump)

| # | Do | Expect |
|---|---|---|
| C1 | Upload; relay wired | Serial `[mqtt] connected`; LED on |
| C2 | Start 1 minute by voice/dashboard + yes, then unplug the router | Relay still clicks off after 1 minute (*Safety cut-offs*) |
| C3 | Close the tank-full float while running; repeat with the source-empty float | Pump stops each time; `safety stop` in Serial (*Safety cut-offs*, 10 trials) |
| C4 | Auto mode on; dry the probe, then put it in water | Starts below `DRY_LIMIT`, stops at `TARGET` (*Auto start and stop*, 10 cycles) |
| C5 | Repeat C4 with the network unplugged | Same behaviour (*Offline operation*) |
| C6 | Reset the ESP32 while the pump runs | Pump OFF after reboot |

### D. Real phone and SMS

| # | Do | Expect |
|---|---|---|
| D1 | Call from a verified phone | Language menu in 5 languages |
| D2 | Press 3, *"పంపు 10 నిమిషాలు ఆన్ చేయి"* (pump on for 10 minutes) | Read-back in Telugu |
| D3 | *"అవును"* (yes) and start a stopwatch | Relay on; time it (*Voice and SMS command*: under 30 s) |
| D4 | *"pump off"* | Immediate stop, no question |
| D5 | Stay silent twice | "Sorry, I did not hear you"; the call ends after the third silence |
| D6 | SMS *"pump on 5 min"*, then *"yes"* | Read-back SMS, then confirmation; pump ON |
| D7 | With `ALLOWED_CALLERS` set, call from another phone | "Not registered", then hang-up |

## Troubleshooting

| Problem | Fix |
|---|---|
| Call says "an application error has occurred" | Check the ngrok window for the request. The webhook must be `.../voice/incoming` with **POST**. A `403` means `PUBLIC_URL` doesn't match the ngrok address; fix it, or set `VALIDATE_TWILIO=false` while testing |
| Assistant always says the controller is offline | `DEVICE_ID`, `MQTT_TOPIC_PREFIX` and the broker must match in `config.h` and `.env`. Check Serial Monitor for `[mqtt] connected` |
| Speech not recognised well | Speak after the prompt ends. Mixed words like "pump on" work in every language. The log line `heard: "..."` shows what Twilio transcribed |
| SIM module keeps restarting | Power supply: see the notes under Pins |
| `ANTHROPIC_API_KEY is not set` in the log | Put the key in `backend/.env`; until then the keyword fallback answers |

## Security notes

- The public HiveMQ broker is shared, so anyone who guesses your `DEVICE_ID` could send commands. Use a long, random ID. For real use, use a private broker with a password. On Wi-Fi, HiveMQ Cloud's free tier works: `MQTT_TLS 1`, port 8883 and the credentials in `config.h`, and `MQTT_URL=mqtts://<host>:8883` with `MQTT_USERNAME`/`MQTT_PASSWORD` in `.env`. TLS is not available over the SIM modules (TinyGSM doesn't support it), so a cellular controller needs a password-protected broker that accepts plain connections on port 1883, such as your own Mosquitto server.
- Set `ALLOWED_CALLERS` so only the farmer's phones can control the pump, and `API_TOKEN` before exposing the dashboard.
- Keep `.env` out of git (it is in `.gitignore`).
