import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';

async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Выберите фотографии JPG, PNG или WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Каждая фотография должна быть меньше 10 МБ.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    if (!Number.isFinite(scale) || !image.naturalWidth) throw new Error('Не удалось прочитать фотографию.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.85, .7, .55]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length < 1_398_000) return data;
    }
    throw new Error('Фотография слишком большая. Попробуйте уменьшить её.');
  } finally { URL.revokeObjectURL(url); }
}

export function PhotoUpload({ images, onChange, disabled, onBusy }) {
  const input = useRef(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const upload = async event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length) return;
    setError('');
    if (images.length + files.length > 4) { setError('Можно прикрепить максимум 4 фотографии.'); return; }
    setLoading(true); onBusy(true);
    try {
      const added = [];
      for (const file of files) added.push(await preparePhoto(file));
      onChange([...images, ...added]);
    } catch (e) { setError(e.message || 'Не удалось прочитать фотографию.'); }
    finally { setLoading(false); onBusy(false); }
  };
  return <fieldset className="photo-upload" disabled={disabled || loading}>
    <legend>Фотографии ситуации <span>необязательно</span></legend>
    <p>До 4 фото JPG, PNG или WebP, до 10 МБ каждое. Фото будут видны всем.</p>
    <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="visually-hidden" tabIndex={-1} aria-label="Прикрепить фотографии ситуации" onChange={upload} />
    {images.length > 0 && <div className="photo-previews">{images.map((src, index) => <div key={index}><img src={src} alt={`Выбранная фотография ${index + 1}`} /><button type="button" aria-label={`Удалить фотографию ${index + 1}`} onClick={() => onChange(images.filter((_, i) => i !== index))}><X size={17} /></button></div>)}</div>}
    <button type="button" className="button secondary" disabled={images.length >= 4} onClick={() => input.current.click()}><ImagePlus size={18} />{loading ? 'Обрабатываем фотографии…' : `Добавить фотографии (${images.length}/4)`}</button>
    {error && <p className="message error" role="alert">{error}</p>}
  </fieldset>;
}

export function PhotoGallery({ images = [], compact = false, onOpen }) {
  if (!images.length) return null;
  if (compact) return <div><button type="button" className="proposal-cover" onClick={onOpen} aria-label={`Открыть предложение с фотографиями: ${images.length}`}><img src={images[0].url} loading="lazy" alt="Фотография к предложению" /><span>{images.length} фото</span></button>{images[0].sourceUrl && <small className="photo-credit">Фото: <a href={images[0].sourceUrl} target="_blank" rel="noreferrer">{images[0].sourceName || 'Источник'}</a></small>}</div>;
  return <div className="proposal-gallery">{images.map((image, index) => <figure key={image.id}><a href={image.url} target="_blank" rel="noreferrer" aria-label={`Открыть фотографию ${index + 1} в полном размере`}><img src={image.url} loading="lazy" alt={`Фотография ситуации ${index + 1}`} /></a>{image.sourceUrl && <figcaption>Архивное фото: <a href={image.sourceUrl} target="_blank" rel="noreferrer">{image.sourceName || 'Источник'}</a>. Иллюстрация к демонстрационному заявлению.</figcaption>}</figure>)}</div>;
}
