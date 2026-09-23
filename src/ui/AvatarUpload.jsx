import { useRef, useState } from 'react';
import Avatar from './Avatar.jsx';

export default function AvatarUpload({ src, value, onChange, disabled, onBusy }) {
  const input = useRef(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const upload = async e => {
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setError('');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Выберите фотографию JPG, PNG или WebP.');return;}
    if(file.size>10*1024*1024){setError('Фотография должна быть меньше 10 МБ.');return;}
    setLoading(true);onBusy(true);
    let url;
    try {
      url=URL.createObjectURL(file);
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
      const side=Math.min(image.naturalWidth,image.naturalHeight);
      if(!side)throw new Error('invalid image');
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,512,512);
      ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,512,512);
      onChange(canvas.toDataURL('image/jpeg',.85));
    }catch{setError('Не удалось прочитать фотографию. Попробуйте другой файл.');}
    finally{if(url)URL.revokeObjectURL(url);setLoading(false);onBusy(false);}
  };
  return <div className="avatar-upload"><Avatar src={src} value={value} large /><div><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="visually-hidden" tabIndex={-1} aria-label="Выбрать фотографию из галереи" /><button type="button" className="button secondary" disabled={disabled||loading} onClick={()=>input.current.click()}>{loading?'Обрабатываем…':src?'Изменить фотографию':'Загрузить из галереи'}</button>{src&&<button className="remove-photo" type="button" disabled={disabled||loading} onClick={()=>onChange(null)}>Удалить фото</button>}<p>Фото будет видно рядом с вашими предложениями и отзывами.</p>{error&&<p className="field-error" role="alert">{error}</p>}</div></div>;
}
