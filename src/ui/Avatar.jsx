import { Building2, Mountain, Sun, Leaf, Orbit, Waves, Check } from 'lucide-react';
import { AVATARS, DEFAULT_AVATAR } from '../shared/avatars.js';
const icons = { city: Building2, mountains: Mountain, sun: Sun, leaf: Leaf, orbit: Orbit, waves: Waves };

export default function Avatar({ value = DEFAULT_AVATAR, src, large = false }) {
  if (src) return <img className={`avatar-picture ${large ? 'large' : ''}`} src={src} alt="" style={{ objectFit: 'cover' }} />;
  const avatar = AVATARS.find(item => item.id === value) || AVATARS[0];
  const Icon = icons[avatar.id];
  return <span className={`avatar-picture ${large ? 'large' : ''}`} style={{ color: avatar.color, background: avatar.background }} aria-hidden="true"><Icon size={large ? 30 : 21} strokeWidth={1.8} /></span>;
}

export function AvatarPicker({ value, onChange, disabled }) {
  return <fieldset className="avatar-picker" disabled={disabled}><legend>Выберите аватарку</legend><div className="avatar-options">{AVATARS.map(avatar => <label key={avatar.id} className={`avatar-option ${avatar.id === value ? 'selected' : ''}`}><input type="radio" name="avatar" value={avatar.id} checked={avatar.id === value} onChange={() => onChange(avatar.id)} /><Avatar value={avatar.id} large /><span>{avatar.label}</span>{avatar.id === value && <Check className="avatar-check" size={15} aria-hidden="true" />}</label>)}</div></fieldset>;
}
