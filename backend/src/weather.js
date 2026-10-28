// Rain forecast from Open-Meteo (free, no API key), for the farm's location (FARM_LAT / FARM_LON).
// The forecast only ever *skips* automatic watering on the ESP32; weather never starts the pump.

const LAT = process.env.FARM_LAT;
const LON = process.env.FARM_LON;
const RAIN_PROB_PCT = Number(process.env.RAIN_SKIP_PROBABILITY || 60);
const RAIN_MM = Number(process.env.RAIN_SKIP_MM || 5);

export const weatherConfigured = Boolean(LAT && LON);

export async function getForecast() {
  if (!weatherConfigured) return { ok: false, error: "weather not configured (set FARM_LAT and FARM_LON)" };
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min" +
    "&timezone=auto&forecast_days=3";
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return { ok: false, error: `weather service returned ${res.status}` };
  const d = (await res.json()).daily;
  const days = d.time.map((date, i) => ({
    date,
    rain_mm: d.precipitation_sum[i],
    rain_chance_pct: d.precipitation_probability_max[i],
    max_temp_c: d.temperature_2m_max[i],
    min_temp_c: d.temperature_2m_min[i],
  }));
  const next24h = days.slice(0, 2);
  const rainExpected = next24h.some((x) => x.rain_chance_pct >= RAIN_PROB_PCT || x.rain_mm >= RAIN_MM);
  return { ok: true, rain_expected_next_24h: rainExpected, days };
}

// Every 3 hours, tell the ESP32 whether rain is expected so auto mode can skip watering.
export function startRainSync(device) {
  if (!weatherConfigured) return;
  const sync = async () => {
    try {
      const f = await getForecast();
      if (!f.ok || !device.isOnline()) return;
      await device.sendCommand("set_rain", { rain: f.rain_expected_next_24h });
      console.log(`[weather] rain expected in next 24 h: ${f.rain_expected_next_24h}`);
    } catch (err) {
      console.warn("[weather] sync failed:", err.message);
    }
  };
  setTimeout(sync, 15_000).unref();
  setInterval(sync, 3 * 3600_000).unref();
}
