import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const cookieName = 'qala_session';
const lifetime = 30 * 24 * 60 * 60;

export function installAuth(app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      profile_id TEXT PRIMARY KEY REFERENCES profiles(id), login TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES accounts(profile_id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      profile_id TEXT PRIMARY KEY REFERENCES accounts(profile_id), selected_ids TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  const getToken = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/' };
  const createSession = (res, profileId) => {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), profileId, Date.now() + lifetime * 1000);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime * 1000 });
  };
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Запрос с другого сайта отклонён.' });
    const token = getToken(req);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      req.account = db.prepare(`SELECT p.id, p.nickname, p.team, p.created_at AS createdAt, a.login
        FROM sessions s JOIN profiles p ON p.id = s.profile_id JOIN accounts a ON a.profile_id = p.id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(hash(token), Date.now());
    }
    next();
  });
  const attempts = new Map();
  const limited = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const entry = attempts.get(req.ip) || { count: 0, until: now + 15 * 60 * 1000 };
    entry.count++; attempts.set(req.ip, entry);
    if (entry.count > 30) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    next();
  };
  app.get('/api/auth/me', (req, res) => res.json({ profile: req.account || null }));
  app.post('/api/auth/register', limited, async (req, res) => {
    const login = String(req.body?.login || '').trim().toLowerCase();
    const nickname = String(req.body?.nickname || '').trim().slice(0, 32);
    const password = req.body?.password;
    if (!/^[a-z0-9_.-]{3,40}$/.test(login)) return res.status(400).json({ error: 'Логин: 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний.' });
    if (nickname.length < 2 || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Укажите имя от 2 символов и пароль длиной 8–128 символов.' });
    try {
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await derive(password, salt, 64)).toString('hex');
      const id = randomUUID(), now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?)').run(id, nickname, '', now, now);
        db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(id, login, salt, passwordHash);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      createSession(res, id);
      res.status(201).json({ profile: { id, login, nickname, team: '', createdAt: now } });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Этот логин уже занят.' });
      console.error('Registration failed:', e.message); res.status(500).json({ error: 'Не удалось создать кабинет. Попробуйте ещё раз.' });
    }
  });
  app.post('/api/auth/login', limited, async (req, res) => {
    const login = String(req.body?.login || '').trim().toLowerCase(), password = req.body?.password;
    if (typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Укажите логин и пароль.' });
    try {
      const account = db.prepare('SELECT * FROM accounts WHERE login = ?').get(login);
      const candidate = await derive(password, account?.salt || 'invalid-account-salt', 64);
      if (!account || !timingSafeEqual(candidate, Buffer.from(account.password_hash, 'hex'))) return res.status(401).json({ error: 'Неверный логин или пароль.' });
      createSession(res, account.profile_id);
      const profile = db.prepare('SELECT id, nickname, team, created_at AS createdAt FROM profiles WHERE id = ?').get(account.profile_id);
      res.json({ profile: { ...profile, login } });
    } catch { res.status(500).json({ error: 'Не удалось войти. Попробуйте ещё раз.' }); }
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = getToken(req); if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    res.clearCookie(cookieName, cookieOptions); res.json({ ok: true });
  });
}

export function requireAccount(req, res, next) {
  if (!req.account) return res.status(401).json({ error: 'Войдите в личный кабинет.' });
  const profileId = req.params.id || req.body?.profileId;
  if (profileId && profileId !== req.account.id) return res.status(403).json({ error: 'Этот профиль принадлежит другому пользователю.' });
  next();
}
