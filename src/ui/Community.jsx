import { useEffect, useState } from 'react';
import { Star, MapPin, MessageSquare, Plus, ArrowLeft } from 'lucide-react';
import { CATEGORIES } from '../shared/community.js';
import Avatar from './Avatar.jsx';
import AverageRating from './AverageRating.jsx';
import { PhotoUpload, PhotoGallery } from './ProposalPhotos.jsx';
import './community.css';
const date = value => new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const emptyForm = () => ({ title: '', description: '', location: '', category: 'transport' });

function ProposalDetails({ id, profile, api, onBack, onChanged, onLogin, onNotify }) {
  const [item, setItem] = useState(null), [comments, setComments] = useState(null);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [body, setBody] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setError('');
    Promise.all([api(`/api/proposals/${id}`), api(`/api/proposals/${id}/comments?page=${page}`)])
      .then(([proposal, reviews]) => { if (!cancelled) { setItem(proposal); setComments(reviews); } })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [id, page, revision, profile.id]);
  const act = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); setRevision(value => value + 1); onChanged(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="proposal-details">
    <button className="button secondary" onClick={onBack}><ArrowLeft size={16} /> Все предложения</button>
    {error && <div className="message error" role="alert">{error}</div>}
    {!item ? <p className="community-loading">{error ? 'Предложение недоступно.' : 'Загружаем предложение…'}</p> : <>
      <article className="panel proposal-full">
        <div className="proposal-category">{CATEGORIES.find(category => category.id === item.category)?.label}</div>
        {item.isDemo && <p className="demo-label">Демо · виртуальное заявление</p>}
        <h2>{item.title}</h2>
        <div className="proposal-location"><MapPin size={17} />{item.location}</div>
        <p className="proposal-description">{item.description}</p>
        <PhotoGallery images={item.images} />
        <div className="proposal-author"><Avatar value={item.author.avatar} src={item.author.avatarUrl} /><span>{item.author.nickname}<small>{item.author.isDemo ? 'Виртуальный житель · ' : ''}{date(item.createdAt)}</small></span></div>
        <div className="proposal-rating-summary"><AverageRating value={item.averageRating} count={item.ratingCount} /></div>
        {profile.role === 'citizen' && profile.id !== item.author.id ? <fieldset className="rating-control" disabled={busy}>
          <legend>{item.myRating ? `Ваша оценка: ${item.myRating}. Можно изменить.` : 'Насколько важно это предложение?'}</legend>
          <div>{[1, 2, 3, 4, 5].map(value => <button key={value} type="button" className={value <= (item.myRating || 0) ? 'selected' : ''} aria-label={`Оценить на ${value} из 5`} aria-pressed={item.myRating === value} onClick={() => act(async () => {
            setItem(await api(`/api/proposals/${id}/rating`, { value }, 'PUT'));
            onNotify('Ваша оценка сохранена.');
          })}><Star size={29} fill={value <= (item.myRating || 0) ? 'currentColor' : 'none'} /></button>)}</div>
        </fieldset> : !profile.id ? <button className="button secondary" onClick={onLogin}>Войти, чтобы оценить и написать отзыв</button> : <p className="community-note">{profile.id === item.author.id ? 'Ваше предложение оценивают другие граждане.' : 'Оценки и отзывы доступны гражданам.'}</p>}
      </article>
      <article className="panel proposal-discussion">
        <h2>Отзывы <span>{comments?.total || 0}</span></h2>
        {profile.role === 'citizen' && <form onSubmit={event => {
          event.preventDefault();
          act(async () => { await api(`/api/proposals/${id}/comments`, { body }); setBody(''); setPage(1); onNotify('Отзыв опубликован.'); });
        }}>
          <label htmlFor="review-body">Ваш отзыв</label>
          <textarea id="review-body" value={body} onChange={event => setBody(event.target.value)} required minLength={3} maxLength={1500} rows={3} placeholder="Расскажите, почему это важно для района…" />
          <button className="button primary" disabled={busy || body.trim().length < 3}>Опубликовать отзыв</button>
        </form>}
        {comments?.items.length ? comments.items.map(comment => <div key={comment.id} className="review">
          <Avatar value={comment.author.avatar} src={comment.author.avatarUrl} />
          <div><div className="review-heading"><b>{comment.author.nickname}{comment.author.isDemo && <small className="demo-review"> · демо</small>}</b><time>{date(comment.createdAt)}</time></div><p>{comment.body}</p></div>
        </div>) : <p className="community-note">Пока нет отзывов. Начните обсуждение.</p>}
        {comments && comments.pages > 1 && <Pagination page={page} pages={comments.pages} onPage={setPage} />}
      </article>
    </>}
  </section>;
}

function Pagination({ page, pages, onPage }) {
  return <div className="community-pagination"><button className="button secondary" disabled={page === 1} onClick={() => onPage(page - 1)}>Назад</button><span>{page} / {pages}</span><button className="button secondary" disabled={page === pages} onClick={() => onPage(page + 1)}>Далее</button></div>;
}

export default function Community({ profile, api, onLogin, onNotify }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [category, setCategory] = useState(''), [sort, setSort] = useState('recent');
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(emptyForm), [images, setImages] = useState([]);
  useEffect(() => {
    let cancelled = false;
    setError(''); setData(null);
    api(`/api/proposals?${new URLSearchParams({ category, sort, q: query, page: String(page) })}`)
      .then(result => { if (!cancelled) setData(result); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [category, sort, query, page, revision, profile.id]);
  if (detail) return <ProposalDetails key={detail} id={detail} profile={profile} api={api} onBack={() => setDetail(null)} onChanged={() => setRevision(value => value + 1)} onLogin={onLogin} onNotify={onNotify} />;
  const submit = async event => {
    event.preventDefault();
    if (busy || uploading) return;
    setBusy(true); setError('');
    try {
      const result = await api('/api/proposals', { ...form, images });
      setForm(emptyForm()); setImages([]); setCreating(false); setDetail(result.id); setPage(1); setRevision(value => value + 1);
      onNotify('Предложение опубликовано. Теперь его видят другие жители.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="community">
    <div className="community-intro"><div><h2>Город начинается с жителей</h2><p>Предлагайте улучшения, оценивайте идеи и обсуждайте будущее Астаны.</p></div>
      {profile.role === 'citizen' ? <button className="button primary" disabled={busy || uploading} onClick={() => setCreating(value => !value)}><Plus size={17} />{creating ? 'Закрыть форму' : 'Предложить улучшение'}</button> : !profile.id ? <button className="button primary" onClick={onLogin}>Войти и предложить идею</button> : <span className="role-badge">Обзор предложений для акима</span>}
    </div>
    <p className="community-note">Публичная лента проекта. Публикации не являются официальными обращениями в акимат.</p>
    {error && <div className="message error" role="alert">{error}</div>}
    {creating && profile.role === 'citizen' && <form className="panel proposal-form" onSubmit={submit}>
      <h2>Новое предложение</h2>
      <label>Название<input required minLength={5} maxLength={120} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Например, убрать мусор во дворе" /></label>
      <div className="form-pair"><label>Адрес или район<input required minLength={3} maxLength={180} value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} placeholder="Улица, дом или название участка" /></label><label>Категория<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label></div>
      <label>Что нужно улучшить?<textarea required minLength={20} maxLength={3000} rows={5} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Опишите проблему и предложите решение. Не указывайте личные данные других людей." /></label>
      <PhotoUpload images={images} onChange={setImages} onBusy={setUploading} disabled={busy} />
      <button className="button primary" disabled={busy || uploading}>{uploading ? 'Обрабатываем фото…' : busy ? 'Публикуем…' : 'Опубликовать предложение'}</button>
    </form>}
    <div className="community-filters">
      <form onSubmit={event => { event.preventDefault(); setQuery(search); setPage(1); }}><input aria-label="Поиск предложений" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder="Поиск по названию или адресу" /><button className="button secondary">Найти</button></form>
      <select aria-label="Категория предложений" value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}><option value="">Все категории</option>{CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select>
      <select aria-label="Порядок предложений" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="recent">Сначала новые</option><option value="top">По оценке жителей</option></select>
    </div>
    {!data ? <p className="community-loading">{error ? 'Не удалось загрузить ленту.' : 'Загружаем предложения…'}</p> : !data.items.length ? <div className="panel empty-state"><h3>Пока нет предложений</h3><p>{query || category ? 'Попробуйте изменить поиск или категорию.' : 'Расскажите, что стоит улучшить в вашем районе.'}</p></div> : <>
      <div className="proposal-grid">{data.items.map(item => <article className="panel proposal-card" key={item.id}>
        <span className="proposal-category">{CATEGORIES.find(category => category.id === item.category)?.label}</span>
        {item.isDemo && <span className="demo-label">Демо · виртуальное заявление</span>}
        <PhotoGallery images={item.images} compact onOpen={() => setDetail(item.id)} />
        <h3><button onClick={() => setDetail(item.id)}>{item.title}</button></h3>
        <div className="proposal-location"><MapPin size={16} />{item.location}</div>
        <p>{item.description.length > 180 ? item.description.slice(0, 180) + '…' : item.description}</p>
        <div className="proposal-author"><Avatar value={item.author.avatar} src={item.author.avatarUrl} /><span>{item.author.nickname}<small>{item.author.isDemo ? 'Виртуальный житель · ' : ''}{date(item.createdAt)}</small></span></div>
        <div className="proposal-card-foot"><AverageRating value={item.averageRating} count={item.ratingCount} /><button onClick={() => setDetail(item.id)}><MessageSquare size={17} />{item.commentCount} отзывов</button></div>
        <button className="button secondary" onClick={() => setDetail(item.id)}>Открыть и обсудить</button>
      </article>)}</div>
      {data.pages > 1 && <Pagination page={page} pages={data.pages} onPage={setPage} />}
    </>}
  </section>;
}
