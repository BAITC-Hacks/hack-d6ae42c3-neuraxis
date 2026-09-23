import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, Moon, Wind, Droplets, Gauge, ExternalLink, RefreshCw, CloudLightning } from 'lucide-react';
import './city-overview.css';
const numeric = value => Number.isFinite(value) ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) : '—';
const direction = value => Number.isFinite(value) ? ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][Math.round(value / 45) % 8] : '—';
const localTime = value => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
function conditions(code, day) {
  if (code === 0) return [day ? 'Ясно' : 'Ясная ночь', day ? Sun : Moon];
  if ([1, 2].includes(code)) return ['Переменная облачность', Cloud];
  if (code === 3) return ['Пасмурно', Cloud];
  if ([45, 48].includes(code)) return ['Туман', Cloud];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['Снег', CloudSnow];
  if ([95, 96, 99].includes(code)) return ['Гроза', CloudLightning];
  if ([51, 53, 55, 56, 57].includes(code)) return ['Морось', CloudRain];
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['Дождь', CloudRain];
  return ['Текущая погода', Cloud];
}

export default function CityOverview() {
  const [weather, setWeather] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false, pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (pending) return;
      pending = true; setLoading(true);
      try {
        const response = await fetch('/api/weather', { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить погоду.');
        if (!disposed) { setWeather(data); setError(''); }
      } catch (e) { if (!disposed) { setWeather(null); setError(e.message); } }
      finally { pending = false; if (!disposed) setLoading(false); }
    };
    load(); const interval = setInterval(load, 10 * 60 * 1000);
    return () => { disposed = true; controller.abort(); clearInterval(interval); };
  }, [revision]);
  const current = weather?.current;
  const [description, WeatherIcon] = conditions(current?.weather_code, current?.is_day);
  return <section className="city-overview" aria-label="Карта Астаны и погода">
    <article className="panel live-city-map"><div className="city-panel-heading"><div><h2>Карта Астаны</h2><p>Улицы, районы и места города</p></div><a href="https://yandex.ru/maps/?ll=71.4300%2C51.1500&z=12" target="_blank" rel="noreferrer" aria-label="Открыть карту Астаны в отдельной вкладке"><ExternalLink size={19} /></a></div>
      <iframe title="Интерактивная карта Астаны — Яндекс Карты" src="https://yandex.ru/map-widget/v1/?ll=71.4300%2C51.1500&z=12" loading="lazy" allowFullScreen />
      <div className="map-attribution"><span>Масштабируйте карту и перемещайтесь по городу.</span><a href="https://yandex.ru/maps/?ll=71.4300%2C51.1500&z=12" target="_blank" rel="noreferrer">Яндекс Карты</a></div>
    </article>
    <article className="panel city-weather" aria-busy={loading}><div className="city-panel-heading"><div><h2>Погода в Астане</h2><p>{weather ? `Данные на ${localTime(weather.observedAt)}` : 'Текущие условия в городе'}</p></div><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} aria-label="Обновить погоду"><RefreshCw size={18} className={loading ? 'weather-spinner' : ''} /></button></div>
      {current ? <><div className="weather-main"><WeatherIcon size={48} strokeWidth={1.5} /><div><strong>{numeric(current.temperature_2m)}°</strong><p>{description}</p><small>Ощущается как {numeric(current.apparent_temperature)} °C</small></div></div>
        <dl className="weather-metrics"><div><dt><Wind size={18} />Ветер · {direction(current.wind_direction_10m)}</dt><dd>{numeric(current.wind_speed_10m)} <span>м/с</span></dd></div><div><dt><Wind size={18} />Порывы</dt><dd>{numeric(current.wind_gusts_10m)} <span>м/с</span></dd></div><div><dt><Droplets size={18} />Влажность</dt><dd>{numeric(current.relative_humidity_2m)} <span>%</span></dd></div><div><dt><CloudRain size={18} />Осадки за {numeric(weather.interval / 60)} мин</dt><dd>{numeric(current.precipitation)} <span>мм</span></dd></div><div><dt><Gauge size={18} />Давление</dt><dd>{numeric(current.surface_pressure)} <span>гПа</span></dd></div></dl>
        {weather.stale && <p className="weather-warning" role="status">Не удалось обновить. Показаны последние полученные данные.</p>}
      </> : <div className="weather-empty" role="status"><Cloud size={40} /><p>{loading ? 'Загружаем погоду…' : error || 'Погода временно недоступна.'}</p>{!loading && <button type="button" className="button secondary" onClick={() => setRevision(value => value + 1)}>Попробовать снова</button>}</div>}
      <p className="weather-source">Погодные данные — <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></p>
    </article>
  </section>;
}
