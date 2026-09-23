import { useEffect, useState } from 'react';
import { normalizeEmail, validEmail } from '../shared/validation.js';
import './account.css';

export default function Account({ profile, selectedIds, api, onProfile, onRestore, onHistory, onNotify }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', nickname: '' });
  const [legacy, setLegacy] = useState(false), [touched, setTouched] = useState(false);
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    setError(''); setTouched(false);
    setForm({ email: profile.email || '', password: '', nickname: profile.id ? profile.nickname : '' });
    if (!profile.id) { setDraft(null); return; }
    let cancelled = false;
    api('/api/account/draft').then(value => { if (!cancelled) setDraft(value); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [profile.id]);
  const emailError = !legacy && touched && !validEmail(form.email) ? 'Укажите почту с @ и доменом: имя@example.kz' : '';
  const perform = async action => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const submit = e => {
    e.preventDefault(); setTouched(true);
    if (!profile.id && !legacy && !validEmail(form.email)) return;
    perform(async () => {
      if (profile.id) {
        const updated = await api(`/api/profile/${profile.id}`, { nickname: form.nickname.trim(), team: profile.team || '' }, 'PUT');
        onProfile({ ...profile, ...updated }); onNotify('Профиль успешно обновлён.');
      } else {
        const body = { password: form.password, nickname: form.nickname.trim(), ...(legacy ? { login: form.email.trim() } : { email: normalizeEmail(form.email) }) };
        const result = await api(`/api/auth/${mode}`, body);
        setForm(f => ({ ...f, password: '' })); onProfile(result.profile);
        onNotify(mode === 'register' ? 'Аккаунт успешно создан. Вы вошли в личный кабинет.' : 'Вы успешно вошли в аккаунт.');
      }
    });
  };
  return <section className="account-layout account-simple"><article className="panel account-profile">
    <div className="panel-heading"><h2>{profile.id ? 'Мой профиль' : mode === 'login' ? 'Вход в аккаунт' : 'Создать аккаунт'}</h2></div>
    <div className="account-body">
      {!profile.id && <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setTouched(false); }}>Вход</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setLegacy(false); setError(''); setTouched(false); }}>Регистрация</button></div>}
      <form onSubmit={submit}>
        <label>{legacy ? 'Прежний логин' : 'Почта'}<input type="text" inputMode={legacy ? 'text' : 'email'} value={form.email} readOnly={Boolean(profile.id)} required={!profile.id} maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'email-error' : undefined} onBlur={() => setTouched(true)} onChange={e => { setForm({ ...form, email: e.target.value }); setError(''); }} placeholder={profile.id && !profile.email ? 'Старый аккаунт: ' + profile.login : 'имя@example.kz'} /></label>
        {!profile.id && emailError && <p className="field-error" id="email-error" role="alert">{emailError}</p>}
        {(profile.id || mode === 'register') && <label>Имя<input value={form.nickname} required minLength={2} maxLength={32} autoComplete="name" onChange={e => setForm({ ...form, nickname: e.target.value })} placeholder="Ваше имя" /></label>}
        {!profile.id && <label>Пароль<input type="password" value={form.password} required minLength={mode === 'register' ? 8 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Не менее 8 символов" /></label>}
        {error && <div className="message error" role="alert">{error}</div>}
        <button className="button primary" disabled={busy || (!profile.id && !legacy && !validEmail(form.email))}>{busy ? 'Подождите…' : profile.id ? 'Сохранить изменения' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'}</button>
      </form>
      {!profile.id && mode === 'login' && <button className="legacy-login" onClick={() => { setLegacy(v => !v); setTouched(false); setError(''); }}>{legacy ? 'Войти по почте' : 'У меня аккаунт со старым логином'}</button>}
      {profile.id && <div className="account-shortcuts"><button className="button secondary" onClick={onHistory}>Мои сценарии</button><details className="draft-details"><summary>Черновик плана</summary><p>{draft ? `Сохранено ${draft.selectedIds.length} из 5 решений` : 'Черновик пока не сохранён'}</p><button className="button secondary" disabled={busy} onClick={() => perform(async () => { const saved = await api('/api/account/draft', { selectedIds }, 'PUT'); setDraft(saved); onNotify('Черновик успешно сохранён.'); })}>Сохранить текущий план</button>{draft && <button className="button secondary" onClick={() => onRestore(draft.selectedIds)}>Продолжить черновик</button>}</details><button className="button secondary logout" disabled={busy} onClick={() => perform(async () => { await api('/api/auth/logout', {}); onProfile(null); onNotify('Вы вышли из аккаунта.'); })}>Выйти</button></div>}
    </div></article></section>;
}
