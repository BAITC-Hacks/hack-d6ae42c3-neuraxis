// Explicit live check: uses the configured API key once; never part of npm test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const config = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Set OPENAI_API_KEY in the local .env first.'); process.exit(1);
}
const port = 19373;
let child, diagnostic = '';
try {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, ...config, OPENAI_API_KEY: apiKey, PORT: String(port), DATABASE_PATH: ':memory:', COOKIE_SECURE: 'false', DEMO_DATA: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stderr.on('data', chunk => {
    const match = String(chunk).match(/AI analysis unavailable: (AI_[A-Z_]+|UNKNOWN)(?: (\d{3}))?/);
    if (match) diagnostic = [match[1], match[2]].filter(Boolean).join(' ');
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out.')), 10000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('API ready')) { clearTimeout(timeout); resolve(); } });
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Could not start the test server.')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Test server exited before startup; check port 19373.')); });
  });
  const registration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ email: `${randomUUID()}@example.kz`, nickname: 'Проверка AI', password: randomUUID(), role: 'akim' }),
  });
  const cookie = registration.headers.get('set-cookie')?.split(';')[0];
  if (registration.status !== 201 || !cookie) throw new Error('Could not create the temporary akim session.');
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ selectedIds: ['bus-priority', 'schoolyards', 'inclusive-school', 'street-light', 'service-desk'] }),
  });
  const report = await response.json();
  if (!response.ok || report.source !== 'ai') {
    console.error(JSON.stringify({ ok: false, source: report.source || 'none', diagnostic: diagnostic || 'AI_UNAVAILABLE', status: response.status }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, source: report.source, model: config.OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini', elapsedMs: Date.now() - started, strengths: report.strengths.length, risks: report.risks.length, recommendations: report.recommendations.length }));
  }
} catch {
  console.error('Live AI check failed. Check server startup and network access.');
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
}
