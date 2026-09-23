import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, ArrowLeft, Building2, Check, ChevronRight, Compass, Download, History, Layers3, Leaf, MapPin, Plus, RotateCcw, Route, Shield, Sparkles, Users, Wallet, X, Info, SlidersHorizontal, BarChart3, Save } from 'lucide-react';
import Account from './Account.jsx';
import Community from './Community.jsx';
import CityOverview from './CityOverview.jsx';
import Avatar from './Avatar.jsx';
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
const guestProfile = { nickname: 'Гость', team: '' };
const calculatorViews = new Set(['simulation', 'analytics', 'history']);
export default function App() {
  const [scenario, setScenario] = useState(null),
    [selected, setSelected] = useState({}),
    [step, setStep] = useState(0),
    [requestedView, setRequestedView] = useState('community');
  const [report, setReport] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState(null),
    [runs, setRuns] = useState([]);
  const [profile, setProfile] = useState(guestProfile),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false);
  const [evaluationOpen, setEvaluationOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const revision = useRef(0);
  const profileRef = useRef(guestProfile);
  const profileId = profile.id;
  const canCalculate = authReady && Boolean(profileId) && profile.role === 'akim';
  const hasCalculatorAccess = () => Boolean(profileRef.current.id) && profileRef.current.role === 'akim';
  const view = !canCalculate && calculatorViews.has(requestedView) ? 'community' : requestedView;
  const setView = next => setRequestedView(!hasCalculatorAccess() && calculatorViews.has(next) ? 'community' : next);
  const onProfile = person => {
    const nextProfile = person || guestProfile;
    const previous = profileRef.current;
    profileRef.current = nextProfile;
    if (nextProfile.id !== previous.id || nextProfile.role !== previous.role) {
      revision.current++;
      setSelected({}); setStep(0); setReport(null); setSaved(false); setRuns([]);
      setBusy(false); setSaving(false); setEvaluationOpen(false); setModal(null);
      setError(''); setNotice('');
      setView(hasCalculatorAccess() ? 'simulation' : 'community');
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    setProfile(nextProfile);
    setAuthReady(true);
  };
  const load = () => {
    setError('');
    api('/api/scenario').then(setScenario).catch(e => setError(e.message));
  };
  useEffect(load, []);
  useEffect(() => {
    let cancelled = false;
    api('/api/auth/me').then(data => { if (!cancelled) onProfile(data.profile); }).catch(() => {
      if (!cancelled) { setAuthReady(true); setNotice('Кабинет временно недоступен.'); }
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!canCalculate) { setRuns([]); return; }
    let cancelled = false;
    const currentProfile = profileRef.current;
    const isCurrent = () => !cancelled && hasCalculatorAccess() && profileRef.current.id === currentProfile.id && profileRef.current.role === currentProfile.role;
    api(`/api/profile/${profileId}/runs`).then(r => { if (isCurrent()) setRuns(r); }).catch(e => { if (isCurrent()) setError(e.message); });
    return () => { cancelled = true; };
  }, [profileId, canCalculate]);
  useEffect(() => {
    if (!modal) return;
    const handler = e => {
      if (e.key === 'Escape') setModal(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modal]);
  const result = useMemo(() => canCalculate && scenario ? scoreScenario(scenario, Object.values(selected)) : null, [canCalculate, scenario, selected]);
  if (!authReady || !scenario) return <div className="loading"><Compass size={40} /><h2>QALA LAB</h2><p>{error || 'Загружаем город…'}</p>{error && <button onClick={load}>Повторить загрузку</button>}</div>;
  const active = scenario.dimensions[step],
    ActiveIcon = icons[active.icon],
    count = result?.selected.length || 0;
  const changeSelection = next => {
    if (!hasCalculatorAccess()) return;
    revision.current++;
    setBusy(false);
    setSaving(false);
    setEvaluationOpen(false);
    setSelected(next);
    setReport(null);
    setSaved(false);
    setError('');
    setNotice('');
  };
  const choose = item => {
    if (!hasCalculatorAccess()) return;
    const next = {
      ...selected,
      [item.dimension]: item.id
    };
    if (selected[item.dimension] === item.id) delete next[item.dimension];
    try {
      scoreScenario(scenario, Object.values(next));
      changeSelection(next);
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
    if (!hasCalculatorAccess()) return;
    const current = revision.current;
    setBusy(true);
    setEvaluationOpen(false);
    setError('');
    try {
      const data = await api('/api/analyze', {
        selectedIds: Object.values(selected)
      });
      if (current === revision.current && hasCalculatorAccess()) {
        setReport(data);
        setView('analytics');
      }
    } catch (e) {
      if (current === revision.current && hasCalculatorAccess()) setError(e.message);
    } finally {
      if (current === revision.current && hasCalculatorAccess()) setBusy(false);
    }
  };
  const save = async () => {
    if (!hasCalculatorAccess()) return;
    const current = revision.current;
    setSaving(true);
    setError('');
    try {
      const run = await api('/api/runs', {
        profileId,
        selectedIds: Object.values(selected),
        report
      });
      if (current === revision.current && hasCalculatorAccess()) {
        setRuns(r => [run, ...r].slice(0, 30));
        setSaved(true);
        setNotice('Сценарий сохранён. Сравните его с другими в истории.');
      }
    } catch (e) {
      if (current === revision.current && hasCalculatorAccess()) setError(e.message);
    } finally {
      if (current === revision.current && hasCalculatorAccess()) setSaving(false);
    }
  };
  const optimize = () => {
    if (!hasCalculatorAccess()) return;
    const best = bestPlan(scenario);
    changeSelection(Object.fromEntries(best.selected.map(i => [i.dimension, i.id])));
    setNotice('Подобран лучший Score среди допустимых комбинаций. Это расчёт модели, а не AI-прогноз.');
  };
  const exportReport = () => {
    if (!hasCalculatorAccess()) return;
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
        setView(canCalculate ? 'simulation' : 'community');
      }}><span className="brand-icon"><Building2 size={24} /></span><span>QALA<span className="brand-light">LAB</span></span></a><nav>{[['simulation', Layers3, 'Симулятор'], ['analytics', BarChart3, 'Аналитика'], ['history', History, 'Мои сценарии'], ['community', Users, 'Предложения']].filter(([id]) => canCalculate || !calculatorViews.has(id)).map(([id, Icon, title]) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)}><Icon size={19} />{title}{id === 'simulation' ? <span className="nav-live" /> : id === 'history' && runs.length > 0 ? <small>{runs.length}</small> : null}</button>)}</nav><div className="sidebar-scenario"><div className="scenario-art"><Building2 size={48} strokeWidth={1} /><span>ASTANA</span></div><h3>Город для жизни</h3><p>{canCalculate ? <>Три района. Пять направлений.<br />Ваше видение будущего.</> : <>Предлагайте идеи.<br />Улучшайте город вместе.</>}</p></div>{canCalculate && <div className="sidebar-bottom"><button className="help-link" onClick={() => setModal('help')}><Info size={18} /> Как устроена модель <ArrowUpRight size={15} /></button></div>}</aside>
  <div className="main-shell"><header className="topbar"><div className="breadcrumb">Рабочее пространство <ChevronRight size={13} /><b>{view === 'simulation' ? 'Симулятор города' : view === 'analytics' ? 'Аналитика сценария' : view === 'account' ? 'Личный кабинет' : view === 'community' ? 'Предложения жителей' : 'Мои сценарии'}</b></div><div className="header-right"><button className={`header-account ${view === 'account' ? 'active' : ''}`} onClick={() => { setModal(null); setNotice(''); setView('account'); window.scrollTo({ top: 0, behavior: 'instant' }); }} aria-label="Личный кабинет"><Avatar value={profile.avatar} src={profile.avatarUrl} /><span className="header-account-copy"><b>{profile.id ? profile.team || profile.nickname : 'Личный кабинет'}</b><small>{profile.id ? (canCalculate ? 'Профиль и сохранения' : 'Мой профиль') : 'Войти / Зарегистрироваться'}</small></span><ChevronRight size={14} /></button></div></header><main><section className="page-heading"><div><h1>{view === 'community' ? <>Ваш голос. <span>Ваш город.</span></> : view === 'account' ? <>Личный кабинет</> : view === 'simulation' ? <>Ваш город. <span>Ваши решения.</span></> : view === 'analytics' ? <>Решения, <span>которые меняют город.</span></> : <>Каждый сценарий — <span>новая возможность.</span></>}</h1><p>{canCalculate ? 'Аким на 5 часов: распределите бюджет и улучшите жизнь горожан.' : 'Предлагайте идеи и обсуждайте, как сделать жизнь в городе лучше.'}</p></div>{canCalculate && <button className="button secondary reset" onClick={() => {
            changeSelection({});
            setStep(0);
            setView('simulation');
          }}><RotateCcw size={15} /> Новый сценарий</button>}</section>
  {error && <div role={error ? 'alert' : 'status'} className={`message ${error ? 'error' : ''}`}><Info size={17} /><span>{error || notice}</span><button aria-label="Закрыть уведомление" onClick={() => {
            setError('');
            setNotice('');
          }}><X size={15} /></button></div>}
  {canCalculate && view === 'simulation' && <CityHero />}
  {(view === 'simulation' || view === 'community') && <CityOverview />}
  {view !== 'account' && view !== 'community' && <section className="summary-grid"><article className="summary-card"><div className="summary-label">Доступный бюджет <Wallet size={18} /></div><div className="summary-value">{number(result.remaining / 1000000)} <span>млн ₸</span></div><div className="budget-track"><span style={{
                width: `${result.cost / scenario.budget * 100}%`
              }} /></div><div className="summary-foot">из 1 млрд ₸ <b>{Math.round(result.cost / scenario.budget * 100)}% распределено</b></div></article><article className="summary-card score-summary"><div className="summary-label">Astana Quality of Life Score <ArrowUpRight size={18} /></div><div className="summary-value">{number(result.score)} <span>/ 100</span><small className="delta">↗ {delta(result.change)}</small></div><div className="summary-foot">Исходный индекс: {number(result.baselineScore)}<span>Прогноз модели</span></div></article><article className="summary-card"><div className="summary-label">Принято решений <Layers3 size={18} /></div><div className="summary-value">{count} <span>/ 5 направлений</span></div><div className="decision-progress">{scenario.dimensions.map(d => <span key={d.id} className={selected[d.id] ? 'done' : ''} />)}</div><div className="summary-foot">{count === 5 ? 'Готово к анализу' : 'По одной инициативе в каждом направлении'}{count === 5 && <Check size={14} />}</div></article></section>}
  {view === 'community' && <Community profile={profile} api={api} onLogin={() => setView('account')} onNotify={setNotice} />}
  {view === 'account' && <Account key={`${profile.id || 'guest'}:${profile.role || ''}`} profile={profile} selectedIds={canCalculate ? Object.values(selected) : []} api={api} onProfile={onProfile} onNotify={setNotice} onCommunity={() => setView('community')} onHistory={() => setView('history')} onRestore={ids => { if (!hasCalculatorAccess()) return; try { scoreScenario(scenario, ids); changeSelection(Object.fromEntries(ids.map(id => { const item = scenario.initiatives.find(i => i.id === id); return [item.dimension, id]; }))); setView('simulation'); } catch(e) { setError(e.message); } }} />}
  {canCalculate && view === 'simulation' && <><section className="planning" id="development-plan"><div className="planning-heading"><div><h2>Соберите свой план развития</h2><p>Выберите один проект в каждом направлении. Каждый выбор имеет значение.</p></div><button className="button secondary" onClick={optimize}><SlidersHorizontal size={16} /> Подобрать по модели</button></div><div className="dimension-tabs">{scenario.dimensions.map((d, i) => {
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
                      if (!hasCalculatorAccess()) return;
                      changeSelection(Object.fromEntries(run.selectedIds.map(id => {
                        const item = scenario.initiatives.find(i => i.id === id);
                        return [item.dimension, id];
                      })));
                      setReport(run.report);
                      setSaved(true);
                      setView('analytics');
                    }}>Открыть <ArrowUpRight size={15} /></button></td></tr>)}</tbody></table></div>}</section>}
  {canCalculate && view !== 'history' && view !== 'account' && view !== 'community' && <section className="analysis-banner"><div><h3>{count === 5 ? 'Ваш план готов. Каким станет город?' : 'Пять решений — одна новая Астана'}</h3><p>{count === 5 ? 'Получите разбор сильных сторон, рисков и последствий вашего сценария.' : `Заполнено ${count} из 5 направлений. Завершите план для итоговой оценки.`}</p></div><button className="button primary" disabled={count !== 5 || busy} onClick={() => setEvaluationOpen(true)}>{busy ? 'Подготавливаем отчёт…' : report ? 'Обновить отчёт' : 'Рассчитать результат'}</button></section>}<footer><span>QALA LAB <i /> {canCalculate ? 'Аким на 5 часов' : 'Город для жизни'}</span>{canCalculate && <button onClick={() => setModal('help')}>Методология <ArrowUpRight size={12} /></button>}</footer></main></div>
  {notice && <FeedbackDialog key={notice} autoCloseMs={3000} title="Уведомление" onClose={() => setNotice('')} confirmLabel="Понятно"><p>{notice}</p></FeedbackDialog>}
  {canCalculate && evaluationOpen && <FeedbackDialog title="Рассчитать результат?" onClose={() => setEvaluationOpen(false)} onConfirm={analyze} confirmLabel="Получить отчёт"><p>Вы выбрали {count} проектов. Расходы — {money(result.cost)}, остаток — {money(result.remaining)}.</p><p>В отчёте вы увидите итоговый индекс, изменения по районам и рекомендации.</p></FeedbackDialog>}
  {canCalculate && modal === 'help' && <div className="modal-backdrop" onMouseDown={e => {
      if (e.target === e.currentTarget) setModal(null);
    }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button autoFocus className="modal-close" onClick={() => setModal(null)} aria-label="Закрыть"><X size={21} /></button><><span className="tiny-label">ПРОЗРАЧНАЯ МОДЕЛЬ</span><h2 id="modal-title">Как работает симулятор</h2><p>У всех команд одинаковый виртуальный бюджет — <b>1 млрд ₸</b>, три условных района и 15 проектов. Выберите ровно один проект в каждом из пяти направлений.</p><p>Каждый проект изменяет показатели своего района. Городской показатель — среднее по районам с учётом населения.</p><div className="formula">Score = Σ (показатель направления × вес)</div>{scenario.dimensions.map(d => <div className="method-row" key={d.id}><span>{d.label}</span><b>{scenario.weights[d.id] * 100}%</b></div>)}<p>AI получает расходы, проекты и рассчитанные показатели, затем объясняет результат и компромиссы. Без API-ключа доступен локальный разбор.</p><p className="fallback">Данные, стоимость и эффекты синтетические. Это не официальная статистика и не реальные сметы. Масштаб исходного сценария: 1 единица = 10 млн ₸.</p></></section></div>}</div>;
}
