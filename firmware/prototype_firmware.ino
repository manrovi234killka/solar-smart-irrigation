// Solar Smart Irrigation: bench prototype starting sketch (ESP32, Arduino core)
// UNTESTED STARTING POINT. Test on the bench with the pump unplugged first, then with a low-voltage pump.
// Wiring (see step 3 and step 4 of the build guide):
//   Soil sensor AOUT -> GPIO34 (analogue input), VCC -> 3V3, GND -> GND
//   Relay IN         -> GPIO26 (relay VCC -> 5V, GND -> GND). Battery + -> COM, NO -> pump +
//   Tank-full float  -> GPIO27 and GND (internal pull-up)
//   Source-empty float -> GPIO25 and GND (internal pull-up)

const int PIN_SOIL = 34;
const int PIN_RELAY = 26;
const int PIN_TANK_FULL = 27;
const int PIN_SOURCE_EMPTY = 25;

// Calibrate these on your own sensor and soil (dry air = 0 %, glass of water = 100 %).
int RAW_DRY = 3200;   // reading in dry air   (placeholder value)
int RAW_WET = 1300;   // reading in water     (placeholder value)
int DRY_LIMIT = 35;   // % : start watering below this (set per crop)
int TARGET = 70;      // % : stop watering at this level
unsigned long MAX_RUN_MS = 20UL * 60UL * 1000UL;  // every run ends on a timer

bool pumpOn = false;
bool rainForecast = false;  // set from the app or weather service later
unsigned long runStart = 0;

int readMoisturePercent() {
  long sum = 0;
  for (int i = 0; i < 10; i++) { sum += analogRead(PIN_SOIL); delay(20); }  // average 10 readings
  long raw = sum / 10;
  int pct = map(raw, RAW_DRY, RAW_WET, 0, 100);
  return constrain(pct, 0, 100);
}

void setPump(bool on) {
  pumpOn = on;
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);  // flip HIGH/LOW if your relay board is active-low
  if (on) runStart = millis();
  Serial.println(on ? "PUMP ON" : "PUMP OFF");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_TANK_FULL, INPUT_PULLUP);
  pinMode(PIN_SOURCE_EMPTY, INPUT_PULLUP);
  setPump(false);  // always start with the pump off
}

void loop() {
  int moisture = readMoisturePercent();
  bool tankFull = digitalRead(PIN_TANK_FULL) == LOW;        // float closed = tank full
  bool sourceEmpty = digitalRead(PIN_SOURCE_EMPTY) == LOW;  // float closed = source empty
  bool timerDone = pumpOn && (millis() - runStart >= MAX_RUN_MS);

  Serial.printf("moisture=%d%% tankFull=%d sourceEmpty=%d pump=%d\n", moisture, tankFull, sourceEmpty, pumpOn);

  if (tankFull || sourceEmpty) {
    if (pumpOn) setPump(false);                  // safety first
  } else if (pumpOn && (moisture >= TARGET || timerDone)) {
    setPump(false);                              // target reached or timer ended
  } else if (!pumpOn && !rainForecast && moisture < DRY_LIMIT) {
    setPump(true);                               // dry soil, no rain expected
  }
  delay(2000);
}
