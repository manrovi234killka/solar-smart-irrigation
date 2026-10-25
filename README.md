# Solar Smart Irrigation

The right amount of water, at the right time, powered by the sun and controlled by a phone call.

A low-cost prototype for small farms: soil sensors decide when to water, a solar-powered pump does the work, and the farmer controls it with a call, a missed call or an SMS, in Telugu, Hindi or English. A crop-aware AI assistant answers farming questions and cites its sources.

**Status:** bench prototype design. The firmware is an untested starting point and no measured results exist yet. The evaluation template in `docs/` is blank on purpose.

## How it works

1. **Sense:** capacitive soil moisture sensors read each field zone.
2. **Decide:** the ESP32 controller combines moisture, the rain forecast and crop rules. A rain forecast skips watering. Weather advice never starts the pump on its own.
3. **Water:** a solar-powered pump runs only as long as needed. A timer, float switches and an optional flow sensor stop every run.
4. **Talk:** the farmer calls or sends an SMS. The assistant reads every command back and waits for a clear yes.

```
Voice call / SMS / phone app / weather API / AI assistant
                      |
              Cloud (Firebase or MQTT)
                      |
              ESP32 controller (works offline, SIM800L for SMS and calls)
                      |
   Moisture sensors · Solar power · Pump, relay and float switches
```

## Repository layout

| Path | What is in it |
|---|---|
| `firmware/prototype_firmware.ino` | Starter ESP32 sketch for the pump logic (untested) |
| `docs/evaluation_results_template.csv` | Six bench tests with proposed pass targets and blank result columns |
| `docs/narration_script.md` | Script for the project film |
| `presentation/Solar_Smart_Irrigation_Final.pptx` | 15-slide deck with embedded video clips |
| `media/CREDITS.md` | Photo and video credits and licences |

## Build it in eight steps

Always switch everything off while wiring, check polarity twice, and have a qualified electrician do any mains wiring.

1. **Gather the parts.** ESP32 board, capacitive soil sensors, 12 V pump with relay module, 10-20 W solar panel, charge controller, 12 V battery, buck converter (12 V to 5 V), two float switches, SIM800L module. Optional: flow sensor, DHT22.
2. **Wire the power chain.** Panel to charge controller to 12 V battery, with a fuse on the battery. Buck converter from the battery to the ESP32 (5 V). The pump takes power from the battery only through the relay.
3. **Connect the soil sensor.** VCC to 3V3, GND to GND, AOUT to GPIO34. Calibrate: dry air is 0 %, a glass of water is 100 %. Average 10 readings.
4. **Relay, pump and floats.** GPIO26 drives the relay input (relay VCC to 5 V, GND to GND). Battery positive to relay COM, relay NO to the pump, pump return to the battery. Tank-full float between GPIO27 and GND, source-empty float between GPIO25 and GND (internal pull-ups).
5. **Program the logic.** Flash `firmware/prototype_firmware.ino`. Test with the pump unplugged first.
6. **App and cloud.** Publish readings and pump status from the ESP32 to Firebase or MQTT, and listen for commands. The controller keeps its own safety rules.
7. **Voice and SMS.** Connect the SIM800L over a serial port with its own supply that can deliver short current bursts. The assistant reads the command back and waits for a yes before an SMS starts the pump.
8. **Test and calibrate.** Run the six tests below and record every result.

### Pin map

| Signal | ESP32 pin |
|---|---|
| Soil sensor AOUT | GPIO34 (analogue input) |
| Relay IN | GPIO26 |
| Tank-full float | GPIO27 to GND |
| Source-empty float | GPIO25 to GND |

### Indicative parts cost

| Part | Rupees (rough) |
|---|---|
| Solar panel 15 W | 1,000 |
| 12 V pump and relay | 800 |
| 12 V battery 7 Ah | 800 |
| SIM800L GSM module | 500 |
| ESP32 board | 450 |
| Soil sensors x2 | 400 |
| Charge controller | 350 |
| Float switches x2 | 250 |
| Buck converter | 80 |
| **Total** | **about 4,630** |

These are planning estimates, not quotes. Confirm prices before ordering.

## Evaluation plan

Proposed pass targets. Agree final values with your guide before testing.

| Test | Pass target |
|---|---|
| Sensor accuracy vs weighed, oven-dried soil sample | Within 5 percentage points after calibration |
| Auto start and stop | Correct in 10 of 10 cycles |
| Voice and SMS command | Under 30 s, and never without a yes |
| Safety cut-offs (timer, floats, dry-run) | Pump stops every time in 10 trials |
| Offline operation | Auto mode still works with the network unplugged |
| Solar supply | Panel output covers the daily pump run |

Record results in `docs/evaluation_results_template.csv`.

## Safety

Reported incidents in Telangana (a snakebite during a power cut, an electrocution at a farm well) motivate the design: start and stop the pump by phone instead of walking to it in the dark. The bench build stays at 12 V.

## Sources for the numbers in the deck

- PM-KUSUM Component B target of 14 lakh standalone solar pumps: Rajya Sabha reply, February 2025.
- Share of groundwater extraction used in agriculture (CGWB), drip-irrigation savings of 30-60 percent, and the small and marginal landholder share (NSSO 2014): secondary summaries. Verify against the original reports before formal use.

## Licence

Code and documents: MIT, see `LICENSE`. Photos and video clips keep their own licences, see `media/CREDITS.md`.
