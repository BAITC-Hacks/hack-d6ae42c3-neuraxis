import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('analysis API coalesces and caches AI reports, with safe fallback on provider failures', { timeout: 20000 }, async () => {
  const apiPort = 19374;
  const marker = 'fake-sensitive-provider-marker-do-not-log';
  const selectedIds = ['bus-priority', 'schoolyards', 'inclusive-school', 'street-light', 'service-desk'];
  const malformedIds = ['safe-crossings', ...selectedIds.slice(1)];
  const failedIds = ['mobility-hub', ...selectedIds.slice(1)];
  const expectedReport = {
    title: 'Разбор сценария',
    summary: 'Бюджетный резерв составляет 150 000 000 ₸.',
    strengths: ['Улучшение транспорта.'],
    risks: ['Ограниченный резерв.'],
    recommendations: ['Сравните эффекты для районов.'],
    source: 'ai',
  };
  let providerCalls = 0;
  let mode = 'success';
  let firstRequest;
  const firstRequestReceived = new Promise(resolve => { firstRequest = resolve; });
  let releaseFirst;
  const firstResponseAllowed = new Promise(resolve => { releaseFirst = resolve; });
  const providerRequests = [];
  const provider = createServer(async (req, res) => {
    providerCalls += 1;
    let body = '';
    for await (const chunk of req) body += chunk;
    providerRequests.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body: JSON.parse(body) });
    if (providerCalls === 1) {
      firstRequest();
      await firstResponseAllowed;
    }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'http-error') {
      res.writeHead(503);
      res.end(JSON.stringify({ error: { message: marker } }));
      return;
    }
    const content = mode === 'malformed'
      ? `{${marker}`
      : JSON.stringify({ ...expectedReport, title: `  ${expectedReport.title}  `, source: 'local', internalNote: marker });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content, refusal: null } }] }));
  });
  let child;
  let childOutput = '';
  let akimCookie = '';
  async function stopChild() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  async function analyze(ids) {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: akimCookie },
      body: JSON.stringify({ selectedIds: ids }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const providerPort = provider.address().port;
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: new URL('..', import.meta.url),
      // Explicit test-only values prevent inherited credentials and dotenv loading.
      env: {
        PORT: String(apiPort),
        DATABASE_PATH: ':memory:',
        OPENAI_API_KEY: 'fake-test-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
        OPENAI_MODEL: 'mock-model',
        COOKIE_SECURE: 'false',
        DEMO_DATA: 'false',
        DOTENV_CONFIG_PATH: fileURLToPath(new URL(`./missing-ai-test-${randomUUID()}.env`, import.meta.url)),
      },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child.stdout.on('data', chunk => { childOutput += chunk; });
    child.stderr.on('data', chunk => { childOutput += chunk; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AI API test server startup timed out')), 10000);
      const onReady = chunk => {
        if (String(chunk).includes('API ready')) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', onReady);
      child.once('error', () => { clearTimeout(timer); reject(new Error('AI API test server could not start')); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`AI API test server exited (${code})`)); });
    });

    async function register(role) {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${randomUUID()}@example.kz`, nickname: 'Тестовый пользователь', password: randomUUID(), role }),
      });
      assert.equal(response.status, 201);
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      return cookie;
    }
    const citizenCookie = await register('citizen');
    for (const [cookie, status] of [['', 401], [citizenCookie, 403]]) {
      const denied = await fetch(`http://127.0.0.1:${apiPort}/api/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ selectedIds, role: 'akim' }),
      });
      assert.equal(denied.status, status);
    }
    assert.equal(providerCalls, 0, 'guests and citizens cannot trigger an AI request');
    akimCookie = await register('akim');

    const first = analyze(selectedIds);
    await firstRequestReceived;
    const simultaneous = analyze([...selectedIds].reverse());
    // Keep the provider response pending while the second request reaches Express.
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(providerCalls, 1);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, simultaneous]), [expectedReport, expectedReport]);
    assert.deepEqual(await analyze(selectedIds), expectedReport);
    assert.equal(providerCalls, 1, 'simultaneous and cached requests share one provider call');
    assert.equal(providerRequests[0].path, '/v1/chat/completions');
    assert.equal(providerRequests[0].method, 'POST');
    assert.equal(providerRequests[0].authorization, 'Bearer fake-test-key');
    assert.equal(providerRequests[0].body.model, 'mock-model');
    assert.equal(JSON.parse(providerRequests[0].body.messages[1].content).currency, 'KZT');

    mode = 'malformed';
    const malformedFallback = await analyze(malformedIds);
    assert.equal(malformedFallback.source, 'local');
    assert.equal(malformedFallback.aiUnavailable, true);
    assert.ok(!JSON.stringify(malformedFallback).includes(marker));
    assert.equal(providerCalls, 2);

    mode = 'http-error';
    const unavailableFallback = await analyze(failedIds);
    assert.equal(unavailableFallback.source, 'local');
    assert.equal(unavailableFallback.aiUnavailable, true);
    assert.ok(!JSON.stringify(unavailableFallback).includes(marker));
    assert.equal(providerCalls, 3);

    mode = 'success';
    assert.deepEqual(await analyze(malformedIds), expectedReport);
    assert.equal(providerCalls, 4, 'failed reports are not cached');
    await stopChild();
    assert.match(childOutput, /AI_INVALID_JSON/);
    assert.match(childOutput, /AI_HTTP_ERROR/);
    assert.ok(!childOutput.includes(marker), 'provider content must not reach child logs');
    assert.ok(!childOutput.includes('fake-test-key'), 'credentials must not reach child logs');
  } finally {
    releaseFirst();
    await stopChild();
    provider.closeAllConnections();
    if (provider.listening) await new Promise(resolve => provider.close(resolve));
  }
});
