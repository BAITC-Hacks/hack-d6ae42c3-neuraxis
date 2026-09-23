import { useEffect, useState } from 'react';
import { ArrowRight, Check, Database, FolderOpen, LogOut, Save, Shield, UserRound } from 'lucide-react';
import './account.css';

export default function Account({ profile, runs, selectedIds, api, onProfile, onRestore, onHistory }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ login: '', password: '', nickname: '', team: '' });
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    setMessage(''); setError('');
    if (profile.id) {
      setForm({ login: profile.login || '', password: '', nickname: profile.nickname, team: profile.team });
      api('/api/account/draft').then(setDraft).catch(e => setError(e.message));
    } else { setDraft(null); setForm({ login: '', password: '', nickname: '', team: '' }); }
  }, [profile.id]);
  const perform = async action => { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const submit = e => {
    e.preventDefault(); perform(async () => {
      if (profile.id) {
        const updated = await api(`/api/profile/${profile.id}`, { nickname: form.nickname, team: form.team }, 'PUT');
        onProfile({ ...profile, ...updated }); setMessage('Изменения сохранены в базе данных.');
      } else {
        const result = await api(`/api/auth/${mode}`, form);
        setForm(f => ({ ...f, password: '' })); onProfile(result.profile); setMessage('Вы вошли в личный кабинет.');
      }
    });
  };
  return <section className="account-layout">
    <article className="panel account-profile"><div className="panel-heading"><div><span className="tiny-label">ЛИЧНЫЙ КАБИНЕТ</span><h2>{profile.id ? `Здравствуйте, ${profile.nickname}` : 'Ваши решения сохраняются'}</h2></div><UserRound size={25} /></div>
      <div className="account-body">{!profile.id && <><p className="account-description">Войдите с любого устройства, чтобы продолжить план и сравнить свои результаты.</p><div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Вход</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Регистрация</button></div></>}
      {profile.id && <div className="account-identity"><span className="avatar">{profile.nickname[0].toUpperCase()}</span><div><b>@{profile.login}</b><small>С нами с {new Date(profile.createdAt).toLocaleDateString('ru-RU')}</small></div><span className="account-connected"><Check size={13} /> Вход выполнен</span></div>}
      <form onSubmit={submit}>{!profile.id && <label>Логин<input value={form.login} required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.\-]{3,40}" autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={e => setForm({ ...form, login: e.target.value })} placeholder="Например, neuraxis" /></label>}{(profile.id || mode === 'register') && <label>Ваше имя<input value={form.nickname} required minLength={2} maxLength={32} autoComplete="name" onChange={e => setForm({ ...form, nickname: e.target.value })} placeholder="Как к вам обращаться?" /></label>}{profile.id ? <label>Команда<input value={form.team} maxLength={48} onChange={e => setForm({ ...form, team: e.target.value })} placeholder="Название вашей команды" /></label> : <label>Пароль<input type="password" value={form.password} required minLength={mode === 'register' ? 8 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Не менее 8 символов" /></label>}
        {error && <div className="message error" role="alert">{error}</div>}{message && <div className="message" role="status">{message}</div>}
        <button className="button primary" disabled={busy}>{busy ? 'Подождите…' : profile.id ? 'Сохранить профиль' : mode === 'register' ? 'Создать кабинет' : 'Войти'}<ArrowRight size={16} /></button>
      </form>{profile.id && <button className="button secondary logout" disabled={busy} onClick={() => perform(async () => { await api('/api/auth/logout', {}); onProfile(null); })}><LogOut size={15} /> Выйти из аккаунта</button>}</div>
    </article>
    <div className="account-side"><article className="panel"><div className="panel-heading"><div><span className="tiny-label">ВАШ ПРОГРЕСС</span><h2>Город в ваших руках</h2></div><Database size={21} /></div><div className="account-stats"><div><strong>{runs.length}</strong><span>сценариев в истории</span></div><div><strong>{runs.length ? Math.max(...runs.map(r => r.score)).toFixed(1) : '—'}</strong><span>лучший Score в истории</span></div></div><div className="account-body"><p className="account-description">Профиль, черновик и результаты хранятся в SQLite на сервере. Доступ к ним есть только у вашего аккаунта.</p><button className="button secondary" disabled={!profile.id} onClick={onHistory}>Открыть мои сценарии <ArrowRight size={15} /></button></div></article>
    <article className="panel"><div className="panel-heading"><div><span className="tiny-label">ПРОДОЛЖИТЬ ПОЗЖЕ</span><h2>Черновик плана</h2></div><FolderOpen size={22} /></div><div className="account-body"><p className="account-description">{draft ? `Сохранено ${draft.selectedIds.length} из 5 решений · ${new Date(draft.updatedAt).toLocaleString('ru-RU')}` : 'Сохраните текущий набор решений, даже если выбрали ещё не все пять.'}</p><div className="account-actions"><button className="button primary" disabled={!profile.id || busy} onClick={() => perform(async () => { const result = await api('/api/account/draft', { selectedIds }, 'PUT'); setDraft(result); setMessage('Черновик сохранён. Можно продолжить после следующего входа.'); })}><Save size={15} /> Сохранить текущий план ({selectedIds.length}/5)</button>{draft && <button className="button secondary" onClick={() => onRestore(draft.selectedIds)}>Продолжить черновик <ArrowRight size={15} /></button>}</div></div></article>
    <div className="account-hint"><Shield size={17} /><span>{profile.id ? 'Пароль не хранится открытым текстом. Выход завершает текущую сессию.' : 'Симулятор доступен без входа. Для сохранения прогресса создайте аккаунт. Восстановление забытого пароля пока не предусмотрено.'}</span></div></div>
  </section>;
}
