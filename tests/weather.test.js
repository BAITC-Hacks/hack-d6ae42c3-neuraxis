import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService } from '../server/weather.js';

const baseTime = Date.UTC(2026, 8, 23, 12);
const response = (time, fields = {}) => ({ ok: true, json: async () => ({ current: {
  time: time / 1000, interval: 900, temperature_2m: 12.4, apparent_temperature: 10,
  relative_humidity_2m: 54, weather_code: 2, wind_speed_10m: 4.5, wind_direction_10m: 225,
  wind_gusts_10m: 8, precipitation: 0.1, surface_pressure: 980, is_day: 1, ...fields,
} }) });

test('Weather requests Astana in Celsius and m/s, shares concurrent requests and caches for ten minutes', async () => {
  let time=baseTime,calls=0;
  const weather=createWeatherService({ now:()=>time, fetchImpl:async (url,options)=>{
    calls++;
    assert.equal(url.hostname,'api.open-meteo.com');
    assert.equal(url.searchParams.get('latitude'),'51.1694');
    assert.equal(url.searchParams.get('longitude'),'71.4491');
    assert.equal(url.searchParams.get('wind_speed_unit'),'ms');
    assert.equal(url.searchParams.get('temperature_unit'),'celsius');
    assert.equal(url.searchParams.get('timeformat'),'unixtime');
    assert.ok(options.signal);
    return response(time);
  } });
  const [first,second]=await Promise.all([weather(),weather()]);
  assert.equal(calls,1);assert.deepEqual(first,second);assert.equal(first.stale,false);
  assert.equal(first.observedAt,baseTime);assert.equal(first.current.wind_speed_10m,4.5);
  time+=9*60*1000;await weather();assert.equal(calls,1);
  time+=2*60*1000;await weather();assert.equal(calls,2);
});

test('Weather marks a recent cached response stale on failure, never invents missing or expired data, and recovers', async () => {
  let time=baseTime,fail=false,calls=0;
  const weather=createWeatherService({ now:()=>time, fetchImpl:async ()=>{
    calls++;if(fail)throw new Error('Offline');return response(time,{wind_gusts_10m:null});
  } });
  assert.equal((await weather()).current.wind_gusts_10m,null);
  time+=11*60*1000;fail=true;
  const stale=await weather();assert.equal(stale.stale,true);assert.equal(stale.observedAt,baseTime);
  await weather();assert.equal(calls,2);
  time+=60*60*1000;await assert.rejects(weather(),/Погода временно недоступна/);
  time+=61*1000;fail=false;assert.equal((await weather()).stale,false);
});

test('Weather rejects missing current values, old timestamps and provider errors without a cache', async () => {
  for(const bad of [response(baseTime,{temperature_2m:null}),response(baseTime-2*60*60*1000),{ok:false},{ok:true,json:async()=>({})}]) {
    const weather=createWeatherService({now:()=>baseTime,fetchImpl:async()=>bad});
    await assert.rejects(weather(),/Погода временно недоступна/);
  }
});
