import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Building2,
  Check, ChevronRight, CircleHelp, Clock3, Coins, Compass, Leaf, Lightbulb,
  LoaderCircle, MapPin, RotateCcw, Route, Shield, Sparkles, Users, Wallet,
} from 'lucide-react';

const iconByName = { route: Route, leaf: Leaf, users: Users, shield: Shield, building: Building2 };
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);

export default function App() {
  const [scenario, setScenario] = useState(null);
  const [selected, setSelected] = useState({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/scenario').then((r) => { if (!r.ok) throw new Error('Сервер не отвечает'); return r.json(); })
      .then(setScenario).catch((e) => setError(e.message));
  }, []);

  const selectedIds = useMemo(() => Object.values(selected), [selected]);
  useEffect(() => {
    if (!scenario) return;
    const controller = new AbortController();
    fetch('/api/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedIds }), signal: controller.signal,
    }).then((r) => r.json()).then((data) => { if (!data.error) setResult(data); })
      .catch((e) => { if (e.name !== 'AbortError') setError('Не удалось пересчитать показатели.'); });
    return () => controller.abort();
  }, [scenario, selectedIds.join('|')]);

  if (!scenario || !result) return <div className="loading-screen"><div className="loading-mark"><Compass size={27} /></div><span>{error || 'Загружаем городской сценарий…'}</span></div>;

  const dimensions = scenario.dimensions;
  const active = dimensions[activeIndex];
  const ActiveIcon = iconByName[active.icon] || Building2;
  const activeInitiatives = scenario.initiatives.filter((item) => item.dimension === active.id);
  const picked = selected[active.id];
  const currentPickedCost = scenario.initiatives.find((item) => item.id === picked)?.cost || 0;
  const spent = result.cost;
  const completion = selectedIds.length;

  const choose = (initiative) => {
    const next = { ...selected, [active.id]: initiative.id };
    const nextSpend = Object.values(next).reduce((sum, id) => sum + scenario.initiatives.find((item) => item.id === id).cost, 0);
    if (nextSpend > scenario.budget) {
      setError(`Эта комбинация превышает бюджет на ${fmt(nextSpend - scenario.budget)} усл. ед. Выберите более доступную меру.`);
      return;
    }
    setError(''); setReport(null); setSelected(next);
  };

  const analyze = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectedIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось подготовить анализ.');
      setReport(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const reset = () => { setSelected({}); setActiveIndex(0); setReport(null); setError(''); };
  const baselineDistrict = scenario.districts;
  const improved = result.change > 0;
  const scoreAngle = Math.max(0, Math.min(100, result.score)) * 3.6;
  const atFinal = completion === 5;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="На главную">
        <span className="brand-symbol"><Compass size={22} strokeWidth={2.4} /></span>
        <span className="brand-copy"><b>ҚАЛА</b><small>ҚАЛА · CITY LAB</small></span>
      </a>
      <div className="topbar-center"><span className="live-dot" /> СИМУЛЯЦИЯ УПРАВЛЕНИЯ ГОРОДОМ</div>
      <div className="topbar-actions"><span className="scenario-label"><span className="scenario-dot" /> СЦЕНАРИЙ 01</span><button className="icon-button help-button" title="О симуляции" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}><CircleHelp size={19} /></button></div>
    </header>

    <div className="page-wrap" id="top">
      <section className="intro-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> ГОРОДСКАЯ ЛАБОРАТОРИЯ · АСТАНА</div>
          <h1>Аким на <em>5 часов</em></h1>
          <p className="intro-copy">Пять решений. Один бюджет. Город, в котором хочется жить.</p>
        </div>
        <div className="timer-pill"><Clock3 size={16} /><span>Один игровой сезон</span><b>5 решений</b></div>
      </section>

      <main className="dashboard">
        <aside className="left-rail">
          <section className="budget-card">
            <div className="budget-heading"><span className="overline">ГОРОДСКОЙ БЮДЖЕТ</span><span className="budget-icon"><Wallet size={17} /></span></div>
            <div className="budget-numbers"><strong>{fmt(result.remaining)}</strong><span> / {fmt(scenario.budget)}</span></div>
            <div className="budget-unit">условных единиц осталось</div>
            <div className="budget-track"><span style={{ width: `${spent / scenario.budget * 100}%` }} /></div>
            <div className="budget-foot"><span>Распределено</span><b>{fmt(spent)} усл. ед.</b></div>
            <div className="budget-note"><span className="note-dot" /> Бюджет одинаковый для всех команд</div>
          </section>

          <section className="steps-card">
            <div className="section-head"><span className="overline">ПЛАН РЕШЕНИЙ</span><span className="step-count">{completion}<i> / 5</i></span></div>
            <div className="step-list">
              {dimensions.map((item, index) => {
                const Icon = iconByName[item.icon] || Building2;
                const done = Boolean(selected[item.id]);
                return <button key={item.id} className={`step-item ${index === activeIndex ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => { setActiveIndex(index); setError(''); }}>
                  <span className="step-icon" style={{ '--dimension': item.color }}>{done ? <Check size={15} /> : <Icon size={16} />}</span>
                  <span className="step-label">{item.short}</span>
                  {done ? <span className="step-status">Готово</span> : index === activeIndex ? <span className="step-current">СЕЙЧАС</span> : <span className="step-number">0{index + 1}</span>}
                  <ChevronRight size={14} className="step-chevron" />
                </button>;
              })}
            </div>
            <div className="steps-caption"><span className="progress-dashes">{dimensions.map((d, i) => <i key={d.id} className={i < completion ? 'filled' : ''} />)}</span><span>{completion === 5 ? 'Все решения приняты' : `Осталось ${5 - completion} ${completion === 4 ? 'решение' : 'решения'}`}</span></div>
          </section>
          <div className="fairness-card"><span className="fairness-icon"><BadgeCheck size={16} /></span><p><b>Честное сравнение</b><br />Все команды начинают с одинакового бюджета и данных.</p></div>
        </aside>

        <section className="decision-column">
          <div className="decision-header">
            <div className="decision-title-row"><div className="decision-icon" style={{ '--dimension': active.color }}><ActiveIcon size={21} /></div><div><div className="overline">РЕШЕНИЕ 0{activeIndex + 1} <span className="muted-slash">/ 05</span></div><h2>{active.label}</h2></div></div>
            <p>{active.description}. Выберите одно мероприятие для района города.</p>
          </div>

          <div className="initiative-list">
            {activeInitiatives.map((initiative, index) => {
              const district = scenario.districts.find((d) => d.id === initiative.district);
              const chosen = picked === initiative.id;
              const tooExpensive = initiative.cost > result.remaining + currentPickedCost;
              return <button key={initiative.id} className={`initiative-card ${chosen ? 'selected' : ''} ${tooExpensive && !chosen ? 'unavailable' : ''}`} onClick={() => choose(initiative)} aria-pressed={chosen}>
                <div className="initiative-top"><span className={`initiative-radio ${chosen ? 'checked' : ''}`}>{chosen && <Check size={13} />}</span><span className="initiative-tag">{initiative.tag}</span><span className="initiative-cost"><Coins size={14} /> {initiative.cost} <small>усл. ед.</small></span></div>
                <div className="initiative-main"><div className="initiative-copy"><h3>{initiative.title}</h3><p>{initiative.detail}</p><span className="district-chip"><MapPin size={12} /> {district.name} <i>·</i> {district.zone}</span></div><div className="impact-stack">{Object.entries(initiative.impact).map(([key, val]) => {
                  const label = dimensions.find((d) => d.id === key)?.short || key;
                  return <span key={key} className={`impact-chip ${val < 0 ? 'negative' : ''}`}>{val > 0 ? '+' : ''}{val} <small>{label}</small></span>;
                })}</div></div>
                {chosen && <div className="chosen-label"><Check size={12} /> ВЫБРАНО</div>}
              </button>;
            })}
          </div>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <div className="decision-footer"><div className="selection-hint">{picked ? <><Check size={15} /> Решение зафиксировано. Можно изменить выбор.</> : <><Lightbulb size={15} /> Выберите инициативу, чтобы продолжить.</>}</div><div className="step-controls"><button className="text-button" disabled={activeIndex === 0} onClick={() => setActiveIndex((i) => i - 1)}><ArrowLeft size={15} /> Назад</button><button className="next-button" disabled={activeIndex === 4 || !picked} onClick={() => setActiveIndex((i) => Math.min(4, i + 1))}>Далее <ArrowRight size={15} /></button></div></div>

          <section className="district-section"><div className="district-section-heading"><div><div className="overline">ДАННЫЕ СЦЕНАРИЯ</div><h3>Районы города</h3></div><span className="synthetic-badge"><span /> СИНТЕТИЧЕСКИЕ ДАННЫЕ</span></div><div className="district-grid">{baselineDistrict.map((district) => {
            const projected = result.districts.find((d) => d.id === district.id)?.projected || district.stats;
            const avg = (values) => Math.round(Object.values(values).reduce((a, b) => a + b, 0) / dimensions.length);
            const delta = avg(projected) - avg(district.stats);
            return <article className="district-card" key={district.id}><div className="district-top"><span className="district-marker"><MapPin size={14} /></span><span className="district-pop">{fmt(district.population)} тыс.</span></div><h4>{district.name}</h4><div className="district-zone">{district.zone}</div><div className="district-score-row"><span>Средний индекс</span><b>{avg(projected)}<small>/100</small></b></div><div className="mini-track"><span style={{ width: `${avg(projected)}%` }} /></div><div className={`district-delta ${delta > 0 ? 'up' : ''}`}>{delta > 0 ? <ArrowUpRight size={13} /> : delta < 0 ? <ArrowDownRight size={13} /> : <span className="dash">—</span>}{delta > 0 ? `+${delta}` : delta || 'без изменений'} п. к исходному</div></article>;
          })}</div></section>
        </section>

        <aside className="right-rail">
          <section className="score-card">
            <div className="score-card-head"><span className="overline">КАЧЕСТВО ЖИЗНИ</span><span className="score-badge"><span /> LIVE</span></div>
            <div className="score-meter-wrap"><div className="score-meter" style={{ '--score-angle': `${scoreAngle}deg` }}><div className="score-meter-inner"><small>ASTANA QoL</small><strong>{result.score.toFixed(1)}</strong><span>из 100</span></div></div></div>
            <div className={`score-change ${improved ? 'positive' : ''}`}>{improved ? <ArrowUpRight size={17} /> : <span className="flat-mark">↗</span>}<b>{result.change > 0 ? '+' : ''}{result.change.toFixed(1)}</b><span>к исходному уровню</span></div>
            <div className="score-divider" />
            <div className="metric-list">{dimensions.map((d) => {
              const metric = result.metrics[d.id];
              return <div className="metric-row" key={d.id}><span className="metric-dot" style={{ background: d.color }} /><span className="metric-label">{d.short}</span><div className="metric-bar"><i style={{ width: `${metric.projected}%`, background: d.color }} /></div><b>{metric.projected}</b><small className={metric.change > 0 ? 'metric-up' : ''}>{metric.change > 0 ? '+' : ''}{metric.change}</small></div>;
            })}</div>
            <div className="score-legend"><span><i className="legend-baseline" /> исходное</span><span><i className="legend-current" /> после решений</span></div>
          </section>

          <section className={`analysis-card ${report ? 'has-report' : ''}`}>
            <div className="analysis-heading"><span className="analysis-spark"><Sparkles size={16} /></span><div><b>Аналитика сценария</b><small>{report?.source === 'ai' ? 'AI-анализ решений' : report ? 'Аналитический разбор' : 'Появится после 5 решений'}</small></div></div>
            {!atFinal && <div className="analysis-placeholder"><div className="locked-icon"><Shield size={16} /></div><p>Заполните пять направлений, чтобы увидеть разбор сильных сторон и компромиссов.</p><div className="placeholder-progress">{completion} <span>/</span> 5 решений</div></div>}
            {atFinal && !report && <div className="analyze-prompt"><p>Ваш сценарий готов. Получите объяснение результата, рисков и следующих шагов.</p><button className="analyze-button" onClick={analyze} disabled={busy}>{busy ? <><LoaderCircle size={15} className="spin" /> Анализируем…</> : <><Sparkles size={15} /> Получить AI-разбор <ArrowRight size={14} /></>}</button><small>Итоговый балл рассчитан по модели города</small></div>}
            {report && <div className="report-content"><p className="report-summary">{report.summary}</p><div className="report-group"><b><span className="report-bullet green" />Сильные стороны</b>{report.strengths.map((item, i) => <p key={i}>{item}</p>)}</div><div className="report-group"><b><span className="report-bullet amber" />Риски и компромиссы</b>{report.risks.map((item, i) => <p key={i}>{item}</p>)}</div><div className="report-group"><b><span className="report-bullet blue" />Рекомендации</b>{report.recommendations.map((item, i) => <p key={i}>{item}</p>)}</div>{report.aiUnavailable && <div className="fallback-note">AI-сервис недоступен — показан автоматический разбор по модели.</div>}</div>}
          </section>

          {atFinal && <button className="reset-button" onClick={reset}><RotateCcw size={14} /> Начать новый сценарий</button>}
        </aside>
      </main>
      <footer className="page-footer" id="how-it-works"><div><span className="footer-mark"><Compass size={15} /></span><span>Симулятор городских решений · Астана</span></div><p>Score — взвешенное среднее по пяти направлениям и трём районам с учётом населения.</p><span className="footer-version">PROTOTYPE 01 · 2026</span></footer>
    </div>
  </div>;
}
