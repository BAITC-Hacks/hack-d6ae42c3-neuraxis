import { ArrowRight, MapPin } from 'lucide-react';

export function scrollToPlan() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById('development-plan')?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
}

export default function CityHero() {
  return <section className="city-hero" aria-labelledby="city-hero-title">
    <div className="city-hero-copy">
      <span className="hero-kicker"><MapPin size={13} /> АСТАНА, КАЗАХСТАН</span>
      <h2 id="city-hero-title">Большой город.<br />Пять решений.<br /><em>Ваше будущее.</em></h2>
      <p>От тёплой остановки до зелёной набережной. Создайте город, в котором хочется жить, — начните с одного решения.</p>
      <button className="button primary" onClick={scrollToPlan}>Перейти к проектам <ArrowRight size={17} /></button>
      <span className="hero-caption">1 млрд ₸ на развитие · 5 направлений</span>
    </div>
    <figure className="hero-photo">
      <img src="/images/astana-reference.jpg" alt="Зимняя Астана на закате: Байтерек, небоскрёбы и освещённые городские проспекты" width="547" height="365" fetchPriority="high" />
    </figure>
    <figure className="hero-panorama">
      <img src="/images/astana-panorama.jpg" alt="Вечерняя панорама центра Астаны с Байтереком и огнями городских улиц" width="1336" height="751" decoding="async" />
    </figure>
  </section>;
}
