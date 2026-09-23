import { Star } from 'lucide-react';
const number = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const plural = new Intl.PluralRules('ru-RU');
const forms = { one: 'оценка', few: 'оценки', many: 'оценок', other: 'оценки' };

export default function AverageRating({ value, count }) {
  const rating = Math.max(0, Math.min(5, value || 0));
  return <div className="average-rating" aria-label={count ? `Средняя оценка ${number.format(rating)} из 5, ${count} ${forms[plural.select(count)]}` : 'Пока нет оценок'}>
    <span className="average-stars" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <span className="average-star" key={index}><Star size={20} /><span style={{ width: `${Math.max(0, Math.min(1, rating - index)) * 100}%` }}><Star size={20} fill="currentColor" /></span></span>)}</span>
    <div><b>{count ? `${number.format(rating)} из 5` : 'Нет оценок'}</b><small>{count ? `${count} ${forms[plural.select(count)]} · средняя оценка` : 'Будьте первым, кто оценит'}</small></div>
  </div>;
}
