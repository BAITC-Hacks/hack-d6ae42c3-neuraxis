export function parseAvatar(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 1_400_000) throw new Error('Фотография слишком большая. Максимум 1 МБ после обработки.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Загрузите фотографию JPG, PNG или WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 1024 * 1024 || bytes.toString('base64') !== match[2]) throw new Error('Некорректный файл фотографии.');
  const valid = match[1] === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
  if (!valid) throw new Error('Содержимое файла не соответствует формату фотографии.');
  return { bytes, mime: `image/${match[1]}` };
}

export const avatarUrlSql = (prefix = '') => `CASE WHEN ${prefix}avatar_image IS NOT NULL THEN '/api/avatars/' || ${prefix}id || '?v=' || ${prefix}updated_at ELSE NULL END AS avatarUrl`;
