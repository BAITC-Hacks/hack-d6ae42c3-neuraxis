const CACHE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;
const fields = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation', 'surface_pressure', 'is_day'];
const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
weatherUrl.search = new URLSearchParams({ latitude: '51.1694', longitude: '71.4491', current: fields.join(','), temperature_unit: 'celsius', wind_speed_unit: 'ms', precipitation_unit: 'mm', timezone: 'Asia/Almaty', timeformat: 'unixtime', forecast_days: '1' });

export function createWeatherService({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached, pending, retryAfter = 0;
  const unavailable = () => new Error('Погода временно недоступна. Попробуйте обновить позже.');
  const fallback = () => {
    if (cached && now() - cached.observedAt < MAX_AGE_MS && now() - cached.fetchedAt < MAX_AGE_MS) return { ...cached, stale: true };
    throw unavailable();
  };
  return async () => {
    if (cached && now() - cached.fetchedAt < CACHE_MS && now() - cached.observedAt < MAX_AGE_MS) return { ...cached, stale: false };
    if (now() < retryAfter) return fallback();
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetchImpl(weatherUrl, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw unavailable();
          const data = await response.json(), current = data.current;
          if (!current || !Number.isFinite(current.time) || !Number.isFinite(current.temperature_2m)) throw unavailable();
          const observedAt = current.time * 1000;
          if (now() - observedAt >= MAX_AGE_MS || observedAt - now() > 15 * 60 * 1000) throw unavailable();
          const values = Object.fromEntries(fields.map(field => [field, Number.isFinite(current[field]) ? current[field] : null]));
          cached = { city: 'Астана', observedAt, fetchedAt: now(), interval: Number.isFinite(current.interval) ? current.interval : 900, current: values };
          retryAfter = 0;
          return { ...cached, stale: false };
        } catch { retryAfter = now() + 60 * 1000; return fallback(); }
      })().finally(() => { pending = null; });
    }
    return pending;
  };
}

export function installWeather(app) {
  const getWeather = createWeatherService();
  app.get('/api/weather', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await getWeather()); }
    catch (error) { res.status(503).json({ error: error.message }); }
  });
}
