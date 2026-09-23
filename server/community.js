import { randomUUID } from 'node:crypto';
import { requireAccount } from './auth.js';
import { CATEGORIES } from '../src/shared/community.js';
import { avatarUrlSql, parseAvatar } from './avatar-storage.js';

export function installCommunity(app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES profiles(id), title TEXT NOT NULL,
      description TEXT NOT NULL, location TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proposal_ratings (
      proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id), value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5),
      PRIMARY KEY(proposal_id, profile_id)
    );
    CREATE TABLE IF NOT EXISTS proposal_comments (
      id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES profiles(id), body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proposal_images (
      id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, mime TEXT NOT NULL, image BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS images_proposal ON proposal_images(proposal_id, position);
    CREATE INDEX IF NOT EXISTS proposals_created ON proposals(created_at DESC);
    CREATE INDEX IF NOT EXISTS comments_proposal ON proposal_comments(proposal_id, created_at DESC);
  `);
  for (const [table, name, definition] of [
    ['profiles', 'is_demo', 'INTEGER NOT NULL DEFAULT 0'],
    ['proposals', 'is_demo', 'INTEGER NOT NULL DEFAULT 0'],
    ['proposal_images', 'source_url', 'TEXT'],
    ['proposal_images', 'source_name', 'TEXT'],
  ]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  const citizen = (req, res, next) => req.account.role === 'citizen' ? next() : res.status(403).json({ error: 'Публиковать предложения, ставить оценки и писать отзывы могут граждане.' });
  const exists = (req, res, next) => {
    req.proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
    if (!req.proposal) return res.status(404).json({ error: 'Предложение не найдено.' });
    next();
  };
  const select = `SELECT p.*, u.nickname AS authorName, u.avatar AS authorAvatar, u.is_demo AS authorIsDemo,
    CASE WHEN u.avatar_image IS NOT NULL THEN '/api/avatars/' || u.id || '?v=' || u.updated_at ELSE NULL END AS authorAvatarUrl,
    COALESCE(r.average,0) AS averageRating, COALESCE(r.count,0) AS ratingCount,
    COALESCE(c.count,0) AS commentCount, mine.value AS myRating
    FROM proposals p JOIN profiles u ON u.id = p.author_id
    LEFT JOIN (SELECT proposal_id, AVG(value) AS average, COUNT(*) AS count FROM proposal_ratings GROUP BY proposal_id) r ON r.proposal_id = p.id
    LEFT JOIN (SELECT proposal_id, COUNT(*) AS count FROM proposal_comments GROUP BY proposal_id) c ON c.proposal_id = p.id
    LEFT JOIN proposal_ratings mine ON mine.proposal_id = p.id AND mine.profile_id = ?`;
  const imageList = db.prepare('SELECT id, source_url, source_name FROM proposal_images WHERE proposal_id = ? ORDER BY position');
  const shape = row => ({ id: row.id, title: row.title, description: row.description, location: row.location, category: row.category,
    isDemo: Boolean(row.is_demo),
    images: imageList.all(row.id).map(image => ({ id: image.id, url: `/api/proposal-images/${image.id}`, sourceUrl: image.source_url || null, sourceName: image.source_name || null })),
    createdAt: row.created_at, author: { id: row.author_id, nickname: row.authorName, avatar: row.authorAvatar, avatarUrl: row.authorAvatarUrl, isDemo: Boolean(row.authorIsDemo) },
    averageRating: Math.round(row.averageRating * 10) / 10, ratingCount: row.ratingCount, commentCount: row.commentCount, myRating: row.myRating || null });
  const pageOf = req => Math.max(1, Math.min(100000, Math.floor(Number(req.query.page)) || 1));
  app.get('/api/proposal-images/:id', (req, res) => {
    const image = db.prepare('SELECT mime, image FROM proposal_images WHERE id = ?').get(req.params.id);
    if (!image) return res.status(404).json({ error: 'Фотография не найдена.' });
    res.set({ 'Content-Type': image.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' }).send(Buffer.from(image.image));
  });
  app.get('/api/proposals', (req, res) => {
    const category = String(req.query.category || ''), search = String(req.query.q || '').trim().slice(0,100);
    const where = 'WHERE (? = \'\' OR p.category = ?) AND (? = \'\' OR p.title LIKE ? OR p.location LIKE ?)';
    const params = [category, category, search, `%${search}%`, `%${search}%`];
    const total = db.prepare(`SELECT COUNT(*) AS total FROM proposals p ${where}`).get(...params).total;
    const sort = req.query.sort === 'top' ? 'averageRating DESC, ratingCount DESC, p.created_at DESC' : 'p.created_at DESC';
    const page = pageOf(req);
    const rows = db.prepare(`${select} ${where} ORDER BY ${sort}, p.id DESC LIMIT 12 OFFSET ?`).all(req.account?.id || '', ...params, (page-1)*12);
    res.json({ items: rows.map(shape), page, total, pages: Math.max(1,Math.ceil(total/12)) });
  });
  app.get('/api/proposals/:id', exists, (req,res) => res.json(shape(db.prepare(`${select} WHERE p.id = ?`).get(req.account?.id || '', req.params.id))));
  app.post('/api/proposals', requireAccount, citizen, (req,res) => {
    const field = name => typeof req.body?.[name] === 'string' ? req.body[name].trim() : '';
    const title=field('title'),description=field('description'),location=field('location'),category=field('category');
    if(title.length<5 || title.length>120 || description.length<20 || description.length>3000 || location.length<3 || location.length>180 || !CATEGORIES.some(c=>c.id===category)) return res.status(400).json({error:'Заполните название (5–120), описание (20–3000), адрес (3–180 символов) и категорию.'});
    const uploads = req.body.images === undefined ? [] : req.body.images;
    if (!Array.isArray(uploads) || uploads.length > 4) return res.status(400).json({ error: 'К предложению можно прикрепить до 4 фотографий.' });
    let images;
    try {
      images = uploads.map(value => {
        const photo = parseAvatar(value);
        if (!photo) throw new Error('Прикреплённая фотография не должна быть пустой.');
        return { ...photo, id: randomUUID() };
      });
    } catch (e) { return res.status(400).json({ error: e.message }); }
    const id=randomUUID(),now=new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO proposals (id, author_id, title, description, location, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id,req.account.id,title,description,location,category,now);
      const insertImage = db.prepare('INSERT INTO proposal_images (id, proposal_id, position, mime, image) VALUES (?, ?, ?, ?, ?)');
      images.forEach((image, index) => insertImage.run(image.id, id, index, image.mime, image.bytes));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.status(201).json(shape(db.prepare(`${select} WHERE p.id = ?`).get(req.account.id,id)));
  });
  app.put('/api/proposals/:id/rating', requireAccount, citizen, exists, (req,res) => {
    const value=req.body?.value;
    if(!Number.isInteger(value) || value<1 || value>5) return res.status(400).json({error:'Оценка должна быть целым числом от 1 до 5.'});
    if(req.proposal.author_id===req.account.id) return res.status(403).json({error:'Оценивать можно предложения других граждан.'});
    db.prepare('INSERT INTO proposal_ratings VALUES (?, ?, ?) ON CONFLICT(proposal_id, profile_id) DO UPDATE SET value = excluded.value').run(req.params.id,req.account.id,value);
    res.json(shape(db.prepare(`${select} WHERE p.id = ?`).get(req.account.id,req.params.id)));
  });
  app.get('/api/proposals/:id/comments', exists, (req,res) => {
    const page=pageOf(req),total=db.prepare('SELECT COUNT(*) AS total FROM proposal_comments WHERE proposal_id = ?').get(req.params.id).total;
    const rows=db.prepare(`SELECT c.id,c.body,c.created_at AS createdAt,u.id AS authorId,u.nickname,u.avatar,u.is_demo,${avatarUrlSql('u.')} FROM proposal_comments c JOIN profiles u ON u.id=c.author_id WHERE c.proposal_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET ?`).all(req.params.id,(page-1)*20);
    res.json({items:rows.map(r=>({id:r.id,body:r.body,createdAt:r.createdAt,author:{id:r.authorId,nickname:r.nickname,avatar:r.avatar,avatarUrl:r.avatarUrl,isDemo:Boolean(r.is_demo)}})),page,total,pages:Math.max(1,Math.ceil(total/20))});
  });
  app.post('/api/proposals/:id/comments', requireAccount, citizen, exists, (req,res) => {
    const body=typeof req.body?.body==='string'?req.body.body.trim():'';
    if(body.length<3||body.length>1500) return res.status(400).json({error:'Напишите отзыв длиной от 3 до 1500 символов.'});
    const id=randomUUID(),now=new Date().toISOString();
    db.prepare('INSERT INTO proposal_comments VALUES (?, ?, ?, ?, ?)').run(id,req.params.id,req.account.id,body,now);
    res.status(201).json({id,body,createdAt:now});
  });
}
