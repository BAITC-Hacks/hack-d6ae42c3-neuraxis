export const normalizeEmail = value => typeof value === 'string' ? value.trim().normalize('NFC').toLowerCase() : '';
export function validEmail(value) {
  const email = normalizeEmail(value);
  if (email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[\p{L}\p{N}.!#$%&'*+\-/=?^_`{|}~]+$/u.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every(label => label.length > 0 && label.length <= 63 && /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label)) && /^[\p{L}]{2,63}$/u.test(labels.at(-1));
}
