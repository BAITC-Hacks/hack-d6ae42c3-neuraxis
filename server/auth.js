import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeEmail, validEmail } from '../src/shared/validation.js';
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
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(column => column.name === 'email')) db.exec('ALTER TABLE accounts ADD COLUMN email TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts(email)');
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
      req.account = db.prepare(`SELECT p.id, p.nickname, p.team, p.created_at AS createdAt, a.login, a.email
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
    const email = normalizeEmail(req.body?.email);
    const login = email;
    const nickname = String(req.body?.nickname || '').trim().slice(0, 32);
    const password = req.body?.password;
    if (!validEmail(email)) return res.status(400).json({ error: 'Введите корректную почту, например имя@example.kz. Нужны символ @ и домен.' });
    if (nickname.length < 2 || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Укажите имя от 2 символов и пароль длиной 8–128 символов.' });
    try {
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await derive(password, salt, 64)).toString('hex');
      const id = randomUUID(), now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?)').run(id, nickname, '', now, now);
        db.prepare('INSERT INTO accounts (profile_id, login, salt, password_hash, email) VALUES (?, ?, ?, ?, ?)').run(id, login, salt, passwordHash, email);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      createSession(res, id);
      res.status(201).json({ profile: { id, login, email, nickname, team: '', createdAt: now } });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Эта почта уже зарегистрирована. Войдите в аккаунт.' });
      console.error('Registration failed:', e.message); res.status(500).json({ error: 'Не удалось создать кабинет. Попробуйте ещё раз.' });
    }
  });
  app.post('/api/auth/login', limited, async (req, res) => {
    const login = normalizeEmail(req.body?.email ?? req.body?.login), password = req.body?.password;
    if (req.body?.email !== undefined && !validEmail(login)) return res.status(400).json({ error: 'Введите корректную почту с символом @ и доменом.' });
    if (typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Укажите логин и пароль.' });
    try {
      const account = db.prepare('SELECT * FROM accounts WHERE login = ?').get(login);
      const candidate = await derive(password, account?.salt || 'invalid-account-salt', 64);
      if (!account || !timingSafeEqual(candidate, Buffer.from(account.password_hash, 'hex'))) return res.status(401).json({ error: 'Неверный логин или пароль.' });
      createSession(res, account.profile_id);
      const profile = db.prepare('SELECT id, nickname, team, created_at AS createdAt FROM profiles WHERE id = ?').get(account.profile_id);
      res.json({ profile: { ...profile, login, email: account.email } });
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
