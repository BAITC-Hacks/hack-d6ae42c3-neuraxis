import { useEffect, useRef, useState } from 'react';
import { normalizeEmail, validEmail } from '../shared/validation.js';
import './account.css';
import AvatarUpload from './AvatarUpload.jsx';
import './community.css';
import { DEFAULT_AVATAR } from '../shared/avatars.js';

export default function Account({ profile, selectedIds, api, onProfile, onRestore, onHistory, onNotify, onCommunity }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', nickname: '', avatar: DEFAULT_AVATAR, avatarData: undefined, role: 'citizen' });
  const [uploading, setUploading] = useState(false);
  const [legacy, setLegacy] = useState(false), [touched, setTouched] = useState(false);
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const canCalculate = Boolean(profile.id) && profile.role === 'akim';
  const mounted = useRef(true);
  const identity = useRef('');
  identity.current = `${profile.id || 'guest'}:${profile.role || ''}`;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setError(''); setTouched(false);
    setForm({ email: profile.email || '', password: '', nickname: profile.id ? profile.nickname : '', avatar: profile.avatar || DEFAULT_AVATAR, avatarData: undefined, role: profile.role || 'citizen' });
    setDraft(null);
    if (!canCalculate) return;
    let cancelled = false;
    api('/api/account/draft').then(value => { if (!cancelled) setDraft(value); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [profile.id, profile.role]);
  const emailError = !legacy && touched && !validEmail(form.email) ? 'Укажите почту с @ и доменом: имя@example.kz' : '';
  const perform = async action => {
    const current = identity.current;
    const isCurrent = () => mounted.current && current === identity.current;
    setBusy(true); setError('');
    try { await action(isCurrent); }
    catch (e) { if (isCurrent()) setError(e.message); }
    finally { if (isCurrent()) setBusy(false); }
  };
  const submit = e => {
    e.preventDefault(); setTouched(true);
    if (uploading || (!profile.id && !legacy && !validEmail(form.email))) return;
    perform(async isCurrent => {
      if (profile.id) {
        const updated = await api(`/api/profile/${profile.id}`, { nickname: form.nickname.trim(), team: profile.team || '', avatar: form.avatar, avatarData: form.avatarData }, 'PUT');
        if (!isCurrent()) return;
        onProfile({ ...profile, ...updated }); onNotify('Профиль успешно обновлён.');
      } else {
        const body = { role: form.role, avatarData: form.avatarData, password: form.password, nickname: form.nickname.trim(), avatar: form.avatar, ...(legacy ? { login: form.email.trim() } : { email: normalizeEmail(form.email) }) };
        const result = await api(`/api/auth/${mode}`, body);
        if (!isCurrent()) return;
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
        {!profile.id && mode === 'register' && <fieldset className="role-selector"><legend>Тип аккаунта</legend><div><label><input type="radio" name="role" checked={form.role === 'citizen'} onChange={() => setForm({ ...form, role: 'citizen' })} /> Гражданин</label><label><input type="radio" name="role" checked={form.role === 'akim'} onChange={() => setForm({ ...form, role: 'akim' })} /> Аким</label></div>{form.role === 'akim' && <p>Режим городского симулятора. Выбор роли не подтверждает реальную должность.</p>}</fieldset>}
        {profile.id && <p className="role-badge" style={{marginBottom:20}}>{profile.role === 'akim' ? 'Аким · симулятор' : 'Гражданин'}</p>}
        {(profile.id || mode === 'register') && <AvatarUpload value={form.avatar} src={form.avatarData === undefined ? profile.avatarUrl : form.avatarData} onChange={avatarData => setForm(current => ({ ...current, avatarData }))} disabled={busy} onBusy={setUploading} />}
        <label>{legacy ? 'Прежний логин' : 'Почта'}<input type="text" inputMode={legacy ? 'text' : 'email'} value={form.email} readOnly={Boolean(profile.id)} required={!profile.id} maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'email-error' : undefined} onBlur={() => setTouched(true)} onChange={e => { setForm({ ...form, email: e.target.value }); setError(''); }} placeholder={profile.id && !profile.email ? 'Старый аккаунт: ' + profile.login : 'имя@example.kz'} /></label>
        {!profile.id && emailError && <p className="field-error" id="email-error" role="alert">{emailError}</p>}
        {(profile.id || mode === 'register') && <label>Имя<input value={form.nickname} required minLength={2} maxLength={32} autoComplete="name" onChange={e => setForm({ ...form, nickname: e.target.value })} placeholder="Ваше имя" /></label>}
        {!profile.id && <label>Пароль<input type="password" value={form.password} required minLength={mode === 'register' ? 8 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Не менее 8 символов" /></label>}
        {error && <div className="message error" role="alert">{error}</div>}
        <button className="button primary" disabled={busy || uploading || (!profile.id && !legacy && !validEmail(form.email))}>{busy ? 'Подождите…' : profile.id ? 'Сохранить изменения' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'}</button>
      </form>
      {!profile.id && mode === 'login' && <button className="legacy-login" onClick={() => { setLegacy(v => !v); setTouched(false); setError(''); }}>{legacy ? 'Войти по почте' : 'У меня аккаунт со старым логином'}</button>}
      {profile.id && <div className="account-shortcuts">
        <button className="button secondary" onClick={onCommunity}>Предложения жителей</button>
        {canCalculate && <>
          <button className="button secondary" onClick={onHistory}>Мои сценарии</button>
          <details className="draft-details"><summary>Черновик плана</summary>
            <p>{draft ? `Сохранено ${draft.selectedIds.length} из 5 решений` : 'Черновик пока не сохранён'}</p>
            <button className="button secondary" disabled={busy} onClick={() => perform(async isCurrent => {
              if (!canCalculate || !isCurrent()) return;
              const saved = await api('/api/account/draft', { selectedIds }, 'PUT');
              if (!isCurrent()) return;
              setDraft(saved); onNotify('Черновик успешно сохранён.');
            })}>Сохранить текущий план</button>
            {draft && <button className="button secondary" onClick={() => { if (canCalculate) onRestore(draft.selectedIds); }}>Продолжить черновик</button>}
          </details>
        </>}
        <button className="button secondary logout" disabled={busy} onClick={() => perform(async isCurrent => {
          await api('/api/auth/logout', {});
          if (!isCurrent()) return;
          onProfile(null); onNotify('Вы вышли из аккаунта.');
        })}>Выйти</button>
      </div>}
    </div></article></section>;
}
