import 'dotenv/config';
import { scoreScenario as calculateScore } from '../src/shared/model.js';
import { installAuth, requireAccount, requireAkim } from './auth.js';
import { isAvatar } from '../src/shared/avatars.js';
import { parseAvatar, avatarUrlSql } from './avatar-storage.js';
import { installCommunity } from './community.js';
import { seedDemoData } from './demo-data.js';
import { installWeather } from './weather.js';
import { requestAiReport, AiError } from './ai-client.js';
import scenario from '../data/scenario.json' with { type: 'json' };
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3001);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(process.env.DATABASE_PATH || path.join(root, 'data/astana-simulator.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL DEFAULT 'Гость города',
    team TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scenario_runs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    baseline_score REAL NOT NULL,
    spent INTEGER NOT NULL,
    selected_ids TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scenario_runs_profile_created
    ON scenario_runs(profile_id, created_at DESC);
`);

app.use(express.json({ limit: '6mb' }));
app.use((error, _req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Фотографии слишком большие. Прикрепите до 4 фото размером до 1 МБ после обработки.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный формат запроса.' });
  next(error);
});
installAuth(app, db);
installCommunity(app, db);
// Bundle examples for a fresh local demo; tests use isolated databases without seed data.
if (process.env.DEMO_DATA !== 'false' && process.env.DATABASE_PATH !== ':memory:') seedDemoData(db);
installWeather(app);
app.get('/api/avatars/:id', (req, res) => {
  const row = db.prepare('SELECT avatar_image, avatar_mime FROM profiles WHERE id = ?').get(req.params.id);
  if (!row?.avatar_image) return res.status(404).end();
  res.set({ 'Content-Type': row.avatar_mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }).send(Buffer.from(row.avatar_image));
});

const isProfileId = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
function ensureProfile(id) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO profiles (id, nickname, team, created_at, updated_at)
    VALUES (?, 'Гость города', '', ?, ?)`).run(id, now, now);
  return db.prepare(`SELECT id, nickname, team, avatar, role, ${avatarUrlSql()}, created_at AS createdAt FROM profiles WHERE id = ?`).get(id);
}
function cleanReport(report) {
  if (!report || typeof report !== 'object') return { summary: '', strengths: [], risks: [], recommendations: [] };
  const list = (value) => Array.isArray(value) ? value.slice(0, 3).map((item) => String(item).slice(0, 280)) : [];
  return {
    title: String(report.title || 'Разбор сценария').slice(0, 80),
    summary: String(report.summary || '').slice(0, 600),
    strengths: list(report.strengths),
    risks: list(report.risks),
    recommendations: list(report.recommendations),
    source: report.source === 'ai' ? 'ai' : 'local',
    aiUnavailable: Boolean(report.aiUnavailable),
  };
}

function scoreScenario(ids) { return calculateScore(scenario, ids); }
const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₸';

function localAnalysis(result) {
  const impacts = scenario.dimensions.map(({ id, label }) => ({ label, ...result.metrics[id] }));
  const strengths = [...impacts].sort((a, b) => b.change - a.change).slice(0, 2);
  const risks = [...impacts].sort((a, b) => a.change - b.change).slice(0, 2);
  const percent = Math.round(result.cost / result.budget * 100);
  const leaders = strengths.filter((item) => item.change > 0).map((item) => `${item.label}: +${item.change} п.`);
  const weak = risks[0];
  const tradeoffs = result.selected.flatMap(item => Object.entries(item.impact)
    .filter(([, value]) => value < 0)
    .map(([id, value]) => `${item.title}: ${scenario.dimensions.find(d => d.id === id).label} ${value} п. в районе ${scenario.districts.find(d => d.id === item.district).name}.`));
  const action = result.remaining >= 150000000
    ? `Осталось ${money(result.remaining)}: рассмотрите замену одной из выбранных мер инициативой в направлении «${weak.label}», сохранив общий лимит.`
    : 'Резерв почти исчерпан. Сбалансируйте сценарий заменой одной из мер и сравните ожидаемый эффект для районов.';
  return {
    source: 'local',
    title: 'Разбор сценария',
    summary: `Сценарий повышает Astana Quality of Life Score на ${result.change} пункта и использует ${percent}% общего бюджета.`,
    strengths: leaders.length ? leaders : ['Распределение бюджета сохраняет исходные показатели города.'],
    risks: [...tradeoffs, weak.change < 0 ? `${weak.label}: снижение на ${Math.abs(weak.change)} п.` : `Наименьший прирост — в направлении «${weak.label}» (+${weak.change} п.).`, `Бюджетный резерв: ${money(result.remaining)}`].slice(0, 3),
    recommendations: [action, 'Сверьте выбранный район с распределением населения: направленная мера сильнее меняет результат там, где живёт больше людей.'],
  };
}

async function aiAnalysis(result) {
  if (!process.env.OPENAI_API_KEY) return localAnalysis(result);
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const summaryData = {
    score: result.score,
    baselineScore: result.baselineScore,
    change: result.change,
    currency: 'KZT',
    budget: result.budget,
    spent: result.cost,
    remaining: result.remaining,
    initiatives: result.selected.map(({ title, cost, district, impact }) => ({ title, cost, district, impact })),
    districts: result.districts,
    metrics: scenario.dimensions.map(({ id, label }) => ({ label, ...result.metrics[id] })),
  };
  return requestAiReport(summaryData, { apiKey: process.env.OPENAI_API_KEY, model, baseUrl: base });
}

const analysisCache = new Map(), analysisPending = new Map(), analysisAttempts = new Map();
async function limitedAnalysis(result, clientId) {
  if (!process.env.OPENAI_API_KEY) return localAnalysis(result);
  const now = Date.now(), planKey = result.selected.map(item => item.id).sort().join(',');
  for (const [key, value] of analysisCache) if (value.expires < now) analysisCache.delete(key);
  for (const [key, value] of analysisAttempts) if (value.expires < now) analysisAttempts.delete(key);
  if (analysisCache.has(planKey)) return analysisCache.get(planKey).report;
  if (analysisPending.has(planKey)) return analysisPending.get(planKey);
  const limit = analysisAttempts.get(clientId) || { count: 0, expires: now + 60_000 };
  if (limit.count >= 6 || analysisPending.size >= 2) return { ...localAnalysis(result), aiUnavailable: true };
  limit.count++; analysisAttempts.set(clientId, limit);
  const pending = aiAnalysis(result).then(report => {
    analysisCache.set(planKey, { report, expires: Date.now() + 10 * 60_000 });
    return report;
  }).finally(() => analysisPending.delete(planKey));
  analysisPending.set(planKey, pending);
  return pending;
}

// Upgrade saved demo runs to KZT and the current scoring model.
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  const update = db.prepare('UPDATE scenario_runs SET score = ?, baseline_score = ?, spent = ?, report_json = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const row of db.prepare('SELECT id, selected_ids FROM scenario_runs').all()) {
      const result = scoreScenario(JSON.parse(row.selected_ids));
      update.run(result.score, result.baselineScore, result.cost, JSON.stringify(localAnalysis(result)), row.id);
    }
    db.exec('PRAGMA user_version = 2; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

app.get('/api/scenario', (_req, res) => res.json(scenario));
app.get('/api/profile/:id', requireAccount, (req, res) => {
  if (!isProfileId(req.params.id)) return res.status(400).json({ error: 'Некорректный ID профиля.' });
  res.json(ensureProfile(req.params.id));
});
app.put('/api/profile/:id', requireAccount, (req, res) => {
  if (!isProfileId(req.params.id)) return res.status(400).json({ error: 'Некорректный ID профиля.' });
  const nickname = String(req.body?.nickname || '').trim().slice(0, 32);
  const team = String(req.body?.team || '').trim().slice(0, 48);
  const avatar = req.body?.avatar ?? req.account.avatar;
  if (!isAvatar(avatar)) return res.status(400).json({ error: 'Выберите аватарку из списка.' });
  let photo;
  try { photo = parseAvatar(req.body?.avatarData); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (nickname.length < 2) return res.status(400).json({ error: 'Имя должно содержать минимум 2 символа.' });
  ensureProfile(req.params.id);
  const now = new Date().toISOString();
  db.prepare(`UPDATE profiles SET nickname = ?, team = ?, avatar = ?, updated_at = ?,
    avatar_image = CASE WHEN ? THEN ? ELSE avatar_image END,
    avatar_mime = CASE WHEN ? THEN ? ELSE avatar_mime END WHERE id = ?`)
    .run(nickname, team, avatar, now, Number(photo !== undefined), photo?.bytes || null, Number(photo !== undefined), photo?.mime || null, req.params.id);
  res.json(ensureProfile(req.params.id));
});
app.get('/api/profile/:id/runs', requireAkim, (req, res) => {
  if (!isProfileId(req.params.id)) return res.status(400).json({ error: 'Некорректный ID профиля.' });
  ensureProfile(req.params.id);
  const rows = db.prepare(`SELECT id, score, baseline_score AS baselineScore, spent,
    selected_ids AS selectedIds, report_json AS reportJson, created_at AS createdAt
    FROM scenario_runs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 30`).all(req.params.id);
  res.json(rows.map((row) => ({ ...row, selectedIds: JSON.parse(row.selectedIds), report: JSON.parse(row.reportJson), reportJson: undefined })));
});
app.get('/api/account/draft', requireAkim, (req, res) => {
  const row = db.prepare('SELECT selected_ids, updated_at FROM drafts WHERE profile_id = ?').get(req.account.id);
  res.json(row ? { selectedIds: JSON.parse(row.selected_ids), updatedAt: row.updated_at } : null);
});
app.put('/api/account/draft', requireAkim, (req, res) => {
  try {
    scoreScenario(req.body?.selectedIds);
    const updatedAt = new Date().toISOString();
    db.prepare(`INSERT INTO drafts VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET selected_ids = excluded.selected_ids, updated_at = excluded.updated_at`)
      .run(req.account.id, JSON.stringify(req.body.selectedIds), updatedAt);
    res.json({ selectedIds: req.body.selectedIds, updatedAt });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/runs', requireAkim, (req, res) => {
  const { profileId, selectedIds } = req.body || {};
  if (!isProfileId(profileId)) return res.status(400).json({ error: 'Некорректный ID профиля.' });
  try {
    const result = scoreScenario(selectedIds);
    if (!result.complete) return res.status(400).json({ error: 'Для сохранения завершите все пять решений.' });
    const report = cleanReport(req.body?.report);
    const run = {
      id: randomUUID(), profileId, score: result.score, baselineScore: result.baselineScore,
      spent: result.cost, selectedIds, report, createdAt: new Date().toISOString(),
    };
    ensureProfile(profileId);
    db.prepare(`INSERT INTO scenario_runs
      (id, profile_id, score, baseline_score, spent, selected_ids, report_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(run.id, run.profileId, run.score, run.baselineScore, run.spent,
        JSON.stringify(run.selectedIds), JSON.stringify(run.report), run.createdAt);
    res.status(201).json(run);
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/score', requireAkim, (req, res) => {
  try { res.json(scoreScenario(req.body?.selectedIds)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/analyze', requireAkim, async (req, res) => {
  try {
    const result = scoreScenario(req.body?.selectedIds);
    if (!result.complete) return res.status(400).json({ error: 'Завершите все пять решений перед анализом.' });
    try { res.json(await limitedAnalysis(result, req.ip)); }
    catch (error) {
      console.error('AI analysis unavailable:', error instanceof AiError ? error.code : 'UNKNOWN', error instanceof AiError ? error.status || '' : '');
      res.json({ ...localAnalysis(result), aiUnavailable: true });
    }
  } catch (error) { res.status(400).json({ error: error.message }); }
});

if (fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}

app.listen(port, () => console.log(`City simulator API ready at http://localhost:${port}`));
