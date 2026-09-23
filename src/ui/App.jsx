import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, ArrowLeft, Building2, Check, ChevronRight, Compass, Download, History, Layers3, Leaf, LoaderCircle, MapPin, Plus, RotateCcw, Route, Shield, Sparkles, Users, Wallet, X, Info, SlidersHorizontal, BarChart3, Save } from 'lucide-react';
import Account from './Account.jsx';
import FeedbackDialog from './FeedbackDialog.jsx';
import CityHero, { scrollToPlan } from './CityHero.jsx';
import { scoreScenario, bestPlan } from '../shared/model.js';
const icons = {
  route: Route,
  leaf: Leaf,
  users: Users,
  shield: Shield,
  building: Building2
};
const number = n => new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 1
}).format(n);
const money = n => `${number(n / 1000000)} млн ₸`;
const delta = n => `${n > 0 ? '+' : ''}${number(n)}`;
async function api(url, body, method = 'POST') {
  const response = await fetch(url, body === undefined ? {} : {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Сервер недоступен. Попробуйте ещё раз.');
  return data;
}
function CityMap({
  districts,
  active,
  onSelect,
  selected,
  dimension
}) {
  const paths = ['M80 257L136 316L287 298L373 339L506 295L576 331L574 433L470 462L326 429L220 463L87 388Z', 'M369 65L556 52L659 139L626 251L567 293L506 261L381 304L303 259L350 188Z', 'M97 78L247 53L334 94L316 177L268 236L144 279L74 226L51 157Z'];
  const points = [[335, 373], [489, 170], [192, 163]];
  return <div className="map-stage"><svg className="city-map" viewBox="0 0 720 500" role="group" aria-label="Схема условных районов Астаны">
    <defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#e0e7e1" strokeWidth=".65" /></pattern><pattern id="blocks" width="46" height="42" patternUnits="userSpaceOnUse" patternTransform="rotate(-15)"><rect x="5" y="5" width="29" height="26" rx="3" fill="none" stroke="#b5c9b9" strokeWidth="1" /></pattern></defs>
    <rect width="720" height="500" fill="url(#grid)" /><path d="M-30 350C115 375 118 267 259 281S355 344 460 296S591 287 616 220S658 204 749 185" stroke="#a9d7df" strokeWidth="24" fill="none" />
    {districts.map((d, i) => <g key={d.id} className={`map-district ${active === d.id ? 'is-active' : ''}`} role="button" tabIndex="0" aria-label={`Район ${d.name}`} aria-pressed={active === d.id} onClick={() => onSelect(d.id)} onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(d.id);
        }
      }}><path d={paths[i]} className="district-shape" /><path d={paths[i]} fill="url(#blocks)" opacity=".65" /><g transform={`translate(${points[i][0]},${points[i][1]})`}><rect x="-64" y="-25" width="128" height="61" rx="12" className="map-label-bg" /><text textAnchor="middle" y="-3" className="map-label">{d.name}</text><text textAnchor="middle" y="19" className="map-stat">{number(d.projected[dimension])} / 100</text></g>{selected.filter(item => item.district === d.id).map((item, j) => <g key={item.id} transform={`translate(${points[i][0] - 32 + j * 22},${points[i][1] + 51})`}><circle r="8" fill="#154d36" stroke="white" strokeWidth="2" /><path d="M-3 0L-1 2L3 -2" fill="none" stroke="white" strokeWidth="1.5" /></g>)}</g>)}
    <text x="590" y="324" transform="rotate(-24 590 324)" className="river-label">река Есиль</text><g transform="translate(665 56)"><path d="M0 -18L-7 6L0 2L7 6Z" fill="#315648" /><text y="23" textAnchor="middle" className="map-stat">С</text></g></svg><div className="map-key"><span><i /> Выбранный район</span><span><i /> Водная зона</span></div></div>;
}
export default function App() {
  const [scenario, setScenario] = useState(null),
    [selected, setSelected] = useState({}),
    [step, setStep] = useState(0),
    [districtId, setDistrictId] = useState('almaty'),
    [view, setView] = useState('simulation');
  const [report, setReport] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState(null),
    [runs, setRuns] = useState([]);
  const [profile, setProfile] = useState({
      nickname: 'Городской управленец',
      team: ''
    }),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false);
  const [evaluationOpen, setEvaluationOpen] = useState(false);
  const revision = useRef(0);
  const profileId = profile.id;
  const onProfile = person => {
    if (person?.id !== profile.id) {
      revision.current++; setSaved(false); setRuns([]); setView('simulation'); window.scrollTo({ top: 0, behavior: 'instant' });
      if (!person) { setSelected({}); setReport(null); }
    }
    setProfile(person || { nickname: 'Гость', team: '' });
  };
  const load = () => {
    setError('');
    api('/api/scenario').then(setScenario).catch(e => setError(e.message));
  };
  useEffect(load, []);
  useEffect(() => { api('/api/auth/me').then(data => { if (data.profile) setProfile(data.profile); }).catch(() => setNotice('Кабинет временно недоступен.')); }, []);
  useEffect(() => {
    if (!profileId) { setRuns([]); return; }
    let cancelled = false;
    api(`/api/profile/${profileId}/runs`).then(r => { if (!cancelled) setRuns(r); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [profileId]);
  useEffect(() => {
    if (!modal) return;
    const handler = e => {
      if (e.key === 'Escape') setModal(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modal]);
  const result = useMemo(() => scenario ? scoreScenario(scenario, Object.values(selected)) : null, [scenario, selected]);
  if (!scenario) return <div className="loading"><Compass size={40} /><h2>QALA LAB</h2><p>{error || 'Готовим город к вашим решениям…'}</p>{error && <button onClick={load}>Повторить загрузку</button>}</div>;
  const active = scenario.dimensions[step],
    ActiveIcon = icons[active.icon],
    district = result.districts.find(d => d.id === districtId),
    count = result.selected.length;
  const changeSelection = next => {
    revision.current++;
    setSelected(next);
    setReport(null);
    setSaved(false);
    setError('');
    setNotice('');
  };
  const choose = item => {
    const next = {
      ...selected,
      [item.dimension]: item.id
    };
    if (selected[item.dimension] === item.id) delete next[item.dimension];
    try {
      scoreScenario(scenario, Object.values(next));
      changeSelection(next);
      setDistrictId(item.district);
      if (next[item.dimension]) {
        const nextStep = scenario.dimensions.findIndex(d => d.id === item.dimension) + 1;
        if (nextStep < scenario.dimensions.length) {
          setStep(nextStep);
          requestAnimationFrame(scrollToPlan);
        }
      }
    } catch (e) {
      setError(e.message);
    }
  };
  const analyze = async () => {
    const current = revision.current;
    setBusy(true);
    setEvaluationOpen(false);
    setError('');
    try {
      const data = await api('/api/analyze', {
        selectedIds: Object.values(selected)
      });
      if (current === revision.current) {
        setReport(data);
        setView('analytics');
      }
    } catch (e) {
      if (current === revision.current) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!profileId) { setView('account'); setNotice('Войдите или зарегистрируйтесь, затем сохраните результат в аналитике.'); return; }
    const current = revision.current;
    setSaving(true);
    setError('');
    try {
      const run = await api('/api/runs', {
        profileId,
        selectedIds: Object.values(selected),
        report
      });
      setRuns(r => [run, ...r].slice(0, 30));
      if (current === revision.current) {
        setSaved(true);
        setNotice('Сценарий сохранён. Сравните его с другими в истории.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const optimize = () => {
    const best = bestPlan(scenario);
    changeSelection(Object.fromEntries(best.selected.map(i => [i.dimension, i.id])));
    setNotice('Подобран лучший Score среди допустимых комбинаций. Это расчёт модели, а не AI-прогноз.');
  };
  const exportReport = () => {
    const lines = ['QALA LAB — Аким на 5 часов', `Команда: ${profile.team || profile.nickname}`, `Astana Quality of Life Score: ${result.score} / 100 (${delta(result.change)})`, `Бюджет: ${number(scenario.budget)} ₸`, `Расходы: ${number(result.cost)} ₸. Резерв: ${number(result.remaining)} ₸`, '', ...result.selected.map(i => `${i.title} — ${number(i.cost)} ₸`), '', ...scenario.dimensions.map(d => `${d.label}: ${result.metrics[d.id].baseline} → ${result.metrics[d.id].projected}`), '', report ? `Источник: ${report.source === 'ai' ? 'AI' : 'локальная модель'}\n${report.summary}\n\nСильные стороны\n${report.strengths.join('\n')}\n\nРиски\n${report.risks.join('\n')}\n\nРекомендации\n${report.recommendations.join('\n')}` : '', '', 'Синтетический сценарий. Не официальная статистика и не реальная смета.'];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/plain;charset=utf-8'
    }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'QALA-сценарий.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="app"><aside className="sidebar"><a className="brand" href="#" onClick={e => {
        e.preventDefault();
        setView('simulation');
      }}><span className="brand-icon"><Building2 size={24} /></span><span>QALA<span className="brand-light">LAB</span></span></a><nav>{[['simulation', Layers3, 'Симулятор'], ['analytics', BarChart3, 'Аналитика'], ['history', History, 'Мои сценарии']].map(([id, Icon, title]) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)}><Icon size={19} />{title}{id === 'simulation' ? <span className="nav-live" /> : id === 'history' && runs.length > 0 ? <small>{runs.length}</small> : null}</button>)}</nav><div className="sidebar-scenario"><div className="scenario-art"><Building2 size={48} strokeWidth={1} /><span>ASTANA</span></div><h3>Город для жизни</h3><p>Три района. Пять направлений.<br />Ваше видение будущего.</p></div><div className="sidebar-bottom"><button className="help-link" onClick={() => setModal('help')}><Info size={18} /> Как устроена модель <ArrowUpRight size={15} /></button></div></aside>
  <div className="main-shell"><header className="topbar"><div className="breadcrumb">Рабочее пространство <ChevronRight size={13} /><b>{view === 'simulation' ? 'Симулятор города' : view === 'analytics' ? 'Аналитика сценария' : view === 'account' ? 'Личный кабинет' : 'Мои сценарии'}</b></div><div className="header-right"><button className={`header-account ${view === 'account' ? 'active' : ''}`} onClick={() => { setModal(null); setNotice(''); setView('account'); window.scrollTo({ top: 0, behavior: 'instant' }); }} aria-label="Личный кабинет"><span className="avatar">{(profile.nickname || 'Г')[0].toUpperCase()}</span><span className="header-account-copy"><b>{profile.id ? profile.team || profile.nickname : 'Личный кабинет'}</b><small>{profile.id ? 'Профиль и сохранения' : 'Войти / Зарегистрироваться'}</small></span><ChevronRight size={14} /></button></div></header><main><section className="page-heading"><div><h1>{view === 'account' ? <>Личный кабинет</> : view === 'simulation' ? <>Ваш город. <span>Ваши решения.</span></> : view === 'analytics' ? <>Решения, <span>которые меняют город.</span></> : <>Каждый сценарий — <span>новая возможность.</span></>}</h1><p>Аким на 5 часов: распределите бюджет и улучшите жизнь горожан.</p></div><button className="button secondary reset" onClick={() => {
            changeSelection({});
            setStep(0);
            setView('simulation');
          }}><RotateCcw size={15} /> Новый сценарий</button></section>
  {error && <div role={error ? 'alert' : 'status'} className={`message ${error ? 'error' : ''}`}><Info size={17} /><span>{error || notice}</span><button aria-label="Закрыть уведомление" onClick={() => {
            setError('');
            setNotice('');
          }}><X size={15} /></button></div>}
  {view === 'simulation' && <CityHero />}
  {view !== 'account' && <section className="summary-grid"><article className="summary-card"><div className="summary-label">Доступный бюджет <Wallet size={18} /></div><div className="summary-value">{number(result.remaining / 1000000)} <span>млн ₸</span></div><div className="budget-track"><span style={{
                width: `${result.cost / scenario.budget * 100}%`
              }} /></div><div className="summary-foot">из 1 млрд ₸ <b>{Math.round(result.cost / scenario.budget * 100)}% распределено</b></div></article><article className="summary-card score-summary"><div className="summary-label">Astana Quality of Life Score <ArrowUpRight size={18} /></div><div className="summary-value">{number(result.score)} <span>/ 100</span><small className="delta">↗ {delta(result.change)}</small></div><div className="summary-foot">Исходный индекс: {number(result.baselineScore)}<span>Прогноз модели</span></div></article><article className="summary-card"><div className="summary-label">Принято решений <Layers3 size={18} /></div><div className="summary-value">{count} <span>/ 5 направлений</span></div><div className="decision-progress">{scenario.dimensions.map(d => <span key={d.id} className={selected[d.id] ? 'done' : ''} />)}</div><div className="summary-foot">{count === 5 ? 'Готово к анализу' : 'По одной инициативе в каждом направлении'}{count === 5 && <Check size={14} />}</div></article></section>}
  {view === 'account' && <Account profile={profile} runs={runs} selectedIds={Object.values(selected)} api={api} onProfile={onProfile} onNotify={setNotice} onHistory={() => setView('history')} onRestore={ids => { try { scoreScenario(scenario, ids); changeSelection(Object.fromEntries(ids.map(id => { const item = scenario.initiatives.find(i => i.id === id); return [item.dimension, id]; }))); setView('simulation'); } catch(e) { setError(e.message); } }} />}
  {view === 'simulation' && <><section className="city-grid"><article className="panel map-panel"><div className="panel-heading"><div><h2>Пульс Астаны <span className="live-dot" /></h2></div><span className="map-layer"><Layers3 size={14} /> {active.short}</span></div><CityMap districts={result.districts} active={districtId} onSelect={setDistrictId} selected={result.selected} dimension={active.id} /></article><article className="panel district-panel"><div className="panel-heading"><div><h2>Район {district.name}</h2></div><span className="soft-icon"><MapPin size={19} /></span></div><div className="district-tabs">{result.districts.map(d => <button key={d.id} className={d.id === districtId ? 'active' : ''} onClick={() => setDistrictId(d.id)}>{d.name}</button>)}</div><div className="population"><Users size={16} /><b>{district.population} тыс.</b> жителей <span>{district.zone}</span></div><div className="district-metrics">{scenario.dimensions.map(d => <div className="metric" key={d.id}><div><span>{d.short}</span><b>{number(district.projected[d.id])}<small className={district.projected[d.id] < district.stats[d.id] ? 'negative' : ''}>{delta(district.projected[d.id] - district.stats[d.id])}</small></b></div><div className="metric-track"><span style={{
                      width: `${district.projected[d.id]}%`,
                      background: d.color
                    }} /><i style={{
                      left: `${district.stats[d.id]}%`
                    }} /></div></div>)}</div><div className="district-note"><Info size={14} /><span>Выберите район на схеме, чтобы увидеть влияние ваших решений.</span></div></article></section><section className="planning" id="development-plan"><div className="planning-heading"><div><h2>Соберите свой план развития</h2><p>Выберите один проект в каждом направлении. Каждый выбор имеет значение.</p></div><button className="button secondary" onClick={optimize}><SlidersHorizontal size={16} /> Подобрать по модели</button></div><div className="dimension-tabs">{scenario.dimensions.map((d, i) => {
                const Icon = icons[d.icon];
                return <button key={d.id} className={step === i ? 'active' : ''} onClick={() => setStep(i)}><span className="tab-icon">{selected[d.id] ? <Check size={17} /> : <Icon size={18} />}</span><span>{d.short}</span><small>0{i + 1}</small></button>;
              })}</div><p className="step-announcement" role="status" aria-live="polite">Направление {step + 1} из 5: {active.label}. Выбрано проектов: {count}.</p><div className="projects-heading"><span><ActiveIcon size={17} /> {active.description}</span><small>Эффект указан в пунктах индекса района</small></div><div className="project-grid">{scenario.initiatives.filter(i => i.dimension === active.id).map((item, idx) => {
                const picked = selected[item.dimension] === item.id;
                let unavailable = false;
                try { scoreScenario(scenario, Object.values({ ...selected, [item.dimension]: item.id })); } catch { unavailable = true; }
                return <button key={item.id} className={`project-card ${picked ? 'selected' : ''} ${unavailable ? 'unavailable' : ''}`} aria-pressed={picked} aria-disabled={unavailable} onClick={() => choose(item)}><div className="project-top"><span className="project-number">ПРОЕКТ 0{idx + 1}</span><span className="project-check">{picked ? <Check size={15} /> : <Plus size={15} />}</span></div><span className="project-tag">{item.tag}</span><h3>{item.title}</h3><p>{item.detail}</p><span className="location"><MapPin size={13} /> {scenario.districts.find(d => d.id === item.district).name}</span><div className="impacts">{Object.entries(item.impact).map(([key, value]) => <span key={key} className={value < 0 ? 'negative' : ''}>{delta(value)} <small>{scenario.dimensions.find(d => d.id === key).short}</small></span>)}</div><div className="project-bottom"><strong>{money(item.cost)}</strong><span>{picked ? 'В плане' : unavailable ? 'Нужен резерв на 5 решений' : 'Добавить в план'}{!picked && !unavailable && <ArrowUpRight size={15} />}</span></div></button>;
              })}</div><details className="initiative-sources"><summary>Источники проектов</summary><p>Инициативы на основе практик Астаны. Объём пилота, размещение в учебных районах, цены и эффекты — модельные.</p>{scenario.initiatives.filter(i => i.dimension === active.id).map(i => <a key={i.id} href={i.source.url} target="_blank" rel="noreferrer">{i.title} ↗</a>)}</details><div className="planning-footer"><span><Shield size={15} /> На остальные направления зарезервировано {money(result.reserved)}</span><div><button className="button secondary" disabled={step === 0} onClick={() => setStep(s => s - 1)} aria-label="Предыдущее направление"><ArrowLeft size={16} /></button><button className="button secondary" disabled={step === 4} onClick={() => setStep(s => s + 1)}>Следующее направление <ArrowRight size={16} /></button></div></div></section></>}
  {view === 'analytics' && <section className="analytics-grid"><article className="panel"><div className="panel-heading"><div><h2>Город: до и после</h2></div><BarChart3 size={22} /></div><div className="chart-legend"><span><i /> Исходное</span><span><i /> Ваш сценарий</span></div><div className="comparison-chart">{scenario.dimensions.map(d => <div className="comparison-row" key={d.id}><span>{d.label}</span><div><div className="chart-bar baseline" style={{
                    width: `${result.metrics[d.id].baseline}%`
                  }}>{number(result.metrics[d.id].baseline)}</div><div className="chart-bar projected" style={{
                    width: `${result.metrics[d.id].projected}%`
                  }}>{number(result.metrics[d.id].projected)}</div></div><b>{delta(result.metrics[d.id].change)}</b></div>)}</div><p className="chart-note">Показатели взвешены по населению районов. Шкала: 0–100.</p></article><article className="panel plan-panel"><div className="panel-heading"><div><h2>План развития</h2></div><Wallet size={21} /></div>{scenario.dimensions.map(d => {
              const item = result.selected.find(i => i.dimension === d.id);
              return <div className="plan-row" key={d.id}><span className="plan-dot" style={{
                  background: d.color
                }} /><div><small>{d.short}</small><b>{item?.title || 'Решение ещё не принято'}</b></div><span>{item ? money(item.cost) : '—'}</span></div>;
            })}<div className="plan-total"><span>Итого</span><b>{money(result.cost)}</b></div><button className="button secondary" onClick={() => setView('simulation')}>Изменить решения <ArrowRight size={16} /></button></article>{report && <article className="panel report-panel"><div className="panel-heading"><div><span className="tiny-label">{report.source === 'ai' ? 'AI-АНАЛИЗ' : 'ЛОКАЛЬНАЯ АНАЛИТИКА'}</span><h2>{report.title || 'Разбор сценария'}</h2></div><Sparkles size={23} /></div><p className="report-summary">{report.summary}</p><div className="report-columns">{[['Сильные стороны', report.strengths, 'green'], ['Риски и компромиссы', report.risks, 'amber'], ['Что можно улучшить', report.recommendations, 'blue']].map(([title, items, color]) => <div key={title}><h3><i className={color} />{title}</h3>{items.map((text, i) => <p key={i}>{text}</p>)}</div>)}</div>{report.source !== 'ai' && <p className="fallback">{report.aiUnavailable ? 'AI-провайдер недоступен.' : 'AI-ключ не подключён.'} Показан разбор по данным модели.</p>}<div className="report-actions"><button className="button primary" disabled={saved || saving} onClick={save}><Save size={16} />{saved ? 'Сохранено' : saving ? 'Сохраняем…' : 'Сохранить сценарий'}</button><button className="button secondary" onClick={exportReport}><Download size={16} /> Скачать отчёт</button><button className="button secondary" onClick={() => window.print()}>Печать / PDF</button></div></article>}</section>}
  {view === 'history' && <section className="panel history-panel"><div className="panel-heading"><div><h2>Сравните свои стратегии</h2></div><span>{runs.length} сохранено</span></div>{!runs.length ? <div className="empty-state"><History size={36} /><h3>Первое решение ещё впереди</h3><p>Завершите пять направлений, получите разбор и сохраните сценарий.</p><button className="button primary" onClick={() => setView('simulation')}>К симулятору <ArrowRight size={16} /></button></div> : <div className="history-table"><table><thead><tr><th>Сценарий</th><th>Score</th><th>Прирост</th><th>Расходы</th><th /></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td><b>{run.report?.title || 'Городской сценарий'}</b><small>{new Date(run.createdAt).toLocaleString('ru-RU')}</small></td><td><strong>{number(run.score)}</strong></td><td><span className="delta">{delta(run.score - run.baselineScore)}</span></td><td>{money(run.spent)}</td><td><button className="button secondary" onClick={() => {
                      changeSelection(Object.fromEntries(run.selectedIds.map(id => {
                        const item = scenario.initiatives.find(i => i.id === id);
                        return [item.dimension, id];
                      })));
                      setReport(run.report);
                      setSaved(true);
                      setView('analytics');
                    }}>Открыть <ArrowUpRight size={15} /></button></td></tr>)}</tbody></table></div>}</section>}
  {view !== 'history' && view !== 'account' && <section className="analysis-banner"><div><h3>{count === 5 ? 'Ваш план готов. Каким станет город?' : 'Пять решений — одна новая Астана'}</h3><p>{count === 5 ? 'Получите разбор сильных сторон, рисков и последствий вашего сценария.' : `Заполнено ${count} из 5 направлений. Завершите план для итоговой оценки.`}</p></div><button className="button primary" disabled={count !== 5 || busy} onClick={() => setEvaluationOpen(true)}>{busy ? 'Подготавливаем отчёт…' : report ? 'Обновить отчёт' : 'Рассчитать результат'}</button></section>}<footer><span>QALA LAB <i /> Аким на 5 часов</span><button onClick={() => setModal('help')}>Методология <ArrowUpRight size={12} /></button></footer></main></div>
  {notice && <FeedbackDialog title="Уведомление" onClose={() => setNotice('')} confirmLabel="Понятно"><p>{notice}</p></FeedbackDialog>}
  {evaluationOpen && <FeedbackDialog title="Рассчитать результат?" onClose={() => setEvaluationOpen(false)} onConfirm={analyze} confirmLabel="Получить отчёт"><p>Вы выбрали {count} проектов. Расходы — {money(result.cost)}, остаток — {money(result.remaining)}.</p><p>В отчёте вы увидите итоговый индекс, изменения по районам и рекомендации.</p></FeedbackDialog>}
  {modal && <div className="modal-backdrop" onMouseDown={e => {
      if (e.target === e.currentTarget) setModal(null);
    }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button autoFocus className="modal-close" onClick={() => setModal(null)} aria-label="Закрыть"><X size={21} /></button>{modal === 'help' ? <><span className="tiny-label">ПРОЗРАЧНАЯ МОДЕЛЬ</span><h2 id="modal-title">Как работает симулятор</h2><p>У всех команд одинаковый виртуальный бюджет — <b>1 млрд ₸</b>, три условных района и 15 проектов. Выберите ровно один проект в каждом из пяти направлений.</p><p>Каждый проект изменяет показатели своего района. Городской показатель — среднее по районам с учётом населения.</p><div className="formula">Score = Σ (показатель направления × вес)</div>{scenario.dimensions.map(d => <div className="method-row" key={d.id}><span>{d.label}</span><b>{scenario.weights[d.id] * 100}%</b></div>)}<p>AI получает расходы, проекты и рассчитанные показатели, затем объясняет результат и компромиссы. Без API-ключа доступен локальный разбор.</p><p className="fallback">Карта — условная схема районов, а не географическая карта. Данные, стоимость и эффекты синтетические. Это не официальная статистика и не реальные сметы. Масштаб исходного сценария: 1 единица = 10 млн ₸.</p></> : <><span className="tiny-label">КАБИНЕТ КОМАНДЫ</span><h2 id="modal-title">Кто управляет городом?</h2><form onSubmit={async e => {
            e.preventDefault();
            setSaving(true);
            try {
              await api(`/api/profile/${profileId}`, profile, 'PUT');
              setModal(null);
              setNotice('Профиль сохранён.');
            } catch (err) {
              setError(err.message);
              setModal(null);
            } finally {
              setSaving(false);
            }
          }}><label>Ваше имя<input required minLength={2} maxLength={32} value={profile.nickname} onChange={e => setProfile({
                ...profile,
                nickname: e.target.value
              })} /></label><label>Название команды<input maxLength={48} value={profile.team} onChange={e => setProfile({
                ...profile,
                team: e.target.value
              })} placeholder="Например, Neuraxis" /></label><button className="button primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить профиль'}</button></form><p className="fallback">Демо-профиль привязан к этому браузеру. Сценарии хранятся на сервере.</p></>}</section></div>}</div>;
}
