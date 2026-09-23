import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
export const DEMO_PROFILE_IDS = Object.freeze(Array.from({ length: 4 }, (_, i) => `d3e00000-0000-4000-8000-00000000000${i + 1}`));
export const DEMO_PROPOSAL_IDS = Object.freeze(Array.from({ length: 4 }, (_, i) => `d3e10000-0000-4000-8000-00000000000${i + 1}`));

// These are fictional citizens, not identities or accounts of real people.
const citizens = [
  { nickname: 'Дана Қалақызы', slug: 'dana', avatar: 'leaf' },
  { nickname: 'Аян Нұржол', slug: 'ayan', avatar: 'city' },
  { nickname: 'Мария Соколова', slug: 'maria', avatar: 'sun' },
  { nickname: 'Тимур Айдынов', slug: 'timur', avatar: 'mountains' },
];
const proposals = [
  {
    title: 'Убрать мусор и установить контейнеры во дворе', category: 'cleanup', photo: 'trash',
    description: 'В учебном примере жители предлагают убрать бытовой мусор, установить закрытые контейнеры и согласовать регулярный вывоз.',
    comments: ['Поддерживаю идею контейнеров с крышками и понятного графика вывоза.', 'В этом примере полезно добавить раздельный сбор отходов.'],
  },
  {
    title: 'Подготовить проект благоустройства грунтовой улицы', category: 'transport', photo: 'road',
    description: 'В учебном примере предлагается обследовать грунтовый проезд, продумать водоотвод и безопасный тротуар, затем оценить стоимость покрытия.',
    comments: ['В учебном проекте сначала стоит проверить водоотвод.', 'Поддерживаю включение удобного и безопасного тротуара.'],
  },
  {
    title: 'Ликвидировать стихийную свалку и защитить участок', category: 'cleanup', photo: 'dump',
    description: 'В учебном примере предлагается организовать вывоз накопленных отходов, очистить участок и предусмотреть меры против повторного сброса мусора.',
    comments: ['Для этого примера важно предусмотреть законный вывоз всех отходов.', 'После уборки в учебном проекте можно запланировать озеленение.'],
  },
  {
    title: 'Организовать уборку улицы вместе с жителями', category: 'cleanup', photo: 'trash',
    description: 'В учебном примере предлагается согласовать субботник, обеспечить участников инвентарём и заранее организовать вывоз собранного мусора.',
    comments: ['В демонстрационном плане нужны перчатки, мешки и место сбора.', 'Поддерживаю согласование вывоза до начала уборки.'],
  },
];
const disclosure = 'Демонстрационное предложение вымышленного гражданина. Это учебный сценарий, а не сообщение о новой или текущей проблеме. Реальная архивная фотография Астаны используется только как иллюстрация; точный адрес снимка не заявляется.';

function loadPhotos(photos, rootDir) {
  if (!photos) {
    const manifest = path.join(rootDir, 'data', 'demo-photos.json');
    try { photos = JSON.parse(fs.readFileSync(manifest, 'utf8')); }
    catch { throw new Error('Demo photo manifest unavailable or invalid: data/demo-photos.json'); }
  }
  return Object.fromEntries(['trash', 'road', 'dump'].map(key => {
    const photo = photos[key];
    if (!photo || typeof photo.file !== 'string' || !photo.file || typeof photo.sourceName !== 'string' || !photo.sourceName.trim()
      || typeof photo.sourceUrl !== 'string' || !/^https?:\/\//.test(photo.sourceUrl)
      || !/^\d{4}$/.test(String(photo.year))) {
      throw new Error(`Demo photo metadata invalid: ${key}`);
    }
    let bytes;
    try { bytes = fs.readFileSync(path.resolve(rootDir, photo.file)); }
    catch { throw new Error(`Demo photo unavailable: ${photo.file}`); }
    if (bytes.length < 4 || bytes.length > 1_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error(`Demo photo must be a JPEG under 1 MB: ${photo.file}`);
    }
    return [key, { bytes, sourceUrl: photo.sourceUrl, sourceName: `${photo.sourceName.trim()} (архив, ${photo.year})` }];
  }));
}

function addColumn(db, table, name, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

/**
 * Seed after the base schema, authentication, and community schema are installed.
 * photos is { trash, road, dump }, each with { file, sourceName, sourceUrl, year }.
 * Relative file paths resolve from rootDir (the repository root by default).
 * Existing seed content and account credentials are never overwritten.
 */
export function seedDemoData(db, { photos, rootDir = repositoryRoot } = {}) {
  // Validate all assets first so a missing deployment asset cannot leave partial data.
  const images = loadPhotos(photos, rootDir);
  const now = new Date().toISOString();
  const inserted = { profiles: 0, proposals: 0, images: 0, ratings: 0, comments: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    addColumn(db, 'profiles', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'proposals', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'proposal_images', 'source_url', 'TEXT');
    addColumn(db, 'proposal_images', 'source_name', 'TEXT');
    const getProfile = db.prepare('SELECT is_demo FROM profiles WHERE id = ?');
    const getAccount = db.prepare('SELECT profile_id FROM accounts WHERE profile_id = ?');
    const insertProfile = db.prepare(`INSERT INTO profiles (id, nickname, team, created_at, updated_at, avatar, role, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, 'citizen', 1)`);
    const insertAccount = db.prepare('INSERT INTO accounts (profile_id, login, salt, password_hash, email) VALUES (?, ?, ?, ?, ?)');
    citizens.forEach((citizen, index) => {
      const id = DEMO_PROFILE_IDS[index], existing = getProfile.get(id);
      if (existing && existing.is_demo !== 1) throw new Error('Demo profile ID conflicts with an existing non-demo profile.');
      if (!existing) {
        insertProfile.run(id, citizen.nickname, 'Вымышленный демонстрационный профиль', now, now, citizen.avatar);
        inserted.profiles++;
      }
      if (!getAccount.get(id)) {
        const email = `demo.${citizen.slug}@example.invalid`;
        const salt = randomBytes(16).toString('hex');
        // Discard the random secret after hashing: there is no shared demo password or session.
        const passwordHash = scryptSync(randomBytes(48), salt, 64).toString('hex');
        insertAccount.run(id, email, salt, passwordHash, email);
      }
    });

    const getProposal = db.prepare('SELECT is_demo, author_id FROM proposals WHERE id = ?');
    const insertProposal = db.prepare(`INSERT INTO proposals (id, author_id, title, description, location, category, created_at, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
    const getImage = db.prepare('SELECT proposal_id FROM proposal_images WHERE id = ?');
    const insertImage = db.prepare(`INSERT INTO proposal_images (id, proposal_id, position, mime, image, source_url, source_name)
      VALUES (?, ?, 0, 'image/jpeg', ?, ?, ?)`);
    const insertRating = db.prepare(`INSERT INTO proposal_ratings (proposal_id, profile_id, value) VALUES (?, ?, ?)
      ON CONFLICT(proposal_id, profile_id) DO NOTHING`);
    const getComment = db.prepare('SELECT proposal_id FROM proposal_comments WHERE id = ?');
    const insertComment = db.prepare('INSERT INTO proposal_comments (id, proposal_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)');
    proposals.forEach((proposal, index) => {
      const id = DEMO_PROPOSAL_IDS[index], authorId = DEMO_PROFILE_IDS[index], existing = getProposal.get(id);
      if (existing && (existing.is_demo !== 1 || existing.author_id !== authorId)) throw new Error('Demo proposal ID conflicts with existing content.');
      if (!existing) {
        insertProposal.run(id, authorId, proposal.title, `${proposal.description}\n\n${disclosure}`, 'Астана · условная локация для демонстрации', proposal.category, now);
        inserted.proposals++;
      }
      const photo = images[proposal.photo], imageId = `d3e20000-0000-4000-8000-00000000000${index + 1}`;
      const existingImage = getImage.get(imageId);
      if (existingImage && existingImage.proposal_id !== id) throw new Error('Demo image ID conflicts with existing content.');
      if (!existingImage) {
        insertImage.run(imageId, id, photo.bytes, photo.sourceUrl, photo.sourceName);
        inserted.images++;
      }
      [5, 4].forEach((value, offset) => {
        const profileId = DEMO_PROFILE_IDS[(index + offset + 1) % citizens.length];
        inserted.ratings += Number(insertRating.run(id, profileId, value).changes);
      });
      proposal.comments.forEach((body, offset) => {
        const commentId = `d3e30000-0000-4000-8000-0000000000${index + 1}${offset + 1}`;
        const existingComment = getComment.get(commentId);
        if (existingComment && existingComment.proposal_id !== id) throw new Error('Demo comment ID conflicts with existing content.');
        if (!existingComment) {
          insertComment.run(commentId, id, DEMO_PROFILE_IDS[(index + offset + 1) % citizens.length], `Демонстрационный отзыв: ${body}`, now);
          inserted.comments++;
        }
      });
    });
    db.exec('COMMIT');
    return inserted;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
