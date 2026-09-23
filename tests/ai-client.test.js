import test from 'node:test';
import assert from 'node:assert/strict';
import { AiError, requestAiReport } from '../server/ai-client.js';

const fakeSecret = 'fake-test-secret-do-not-log';
const summaryData = { currency: 'KZT', budget: 1000000000, spent: 850000000, remaining: 150000000, score: 62, initiatives: [] };
const report = {
  title: 'Разбор сценария',
  summary: 'Расходы составляют 850 000 000 ₸.',
  strengths: ['Улучшение транспорта.'],
  risks: ['Ограниченный резерв.'],
  recommendations: ['Сравните эффекты для районов.'],
};
const completion = (content = JSON.stringify(report), extraChoice = {}, extraMessage = {}) => ({
  choices: [{ finish_reason: 'stop', ...extraChoice, message: { content, refusal: null, ...extraMessage } }],
});
const jsonResponse = payload => ({ ok: true, status: 200, json: async () => payload });
const request = (fetchImpl, options = {}) => requestAiReport(summaryData, { apiKey: fakeSecret, fetchImpl, ...options });
async function rejectsSafely(action, code, status) {
  await assert.rejects(action, error => {
    assert.ok(error instanceof AiError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.ok(!`${error.message}\n${error.stack}\n${JSON.stringify(error)}`.includes(fakeSecret));
    assert.equal(error.cause, undefined);
    return true;
  });
}

test('AI request preserves model, sends KZT JSON with bounded generation, and sanitizes report', async () => {
  let calls = 0;
  const actual = await request(async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://example.test/api/v1/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${fakeSecret}` });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'chosen-compatible-model');
    assert.equal(body.temperature, 0.4);
    assert.equal(body.max_completion_tokens, 1200);
    assert.equal(body.store, false);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /на русском/);
    assert.match(body.messages[0].content, /казахстанских тенге/);
    assert.deepEqual(JSON.parse(body.messages[1].content), summaryData);
    assert.ok(!options.body.includes(fakeSecret));
    return jsonResponse(completion(JSON.stringify({ ...report, title: `  ${report.title}  `, source: 'local', unwanted: 'ignored' })));
  }, { model: 'chosen-compatible-model', baseUrl: 'https://example.test/api/v1/' });
  assert.equal(calls, 1);
  assert.deepEqual(actual, { ...report, source: 'ai' });
});

test('default model and endpoint are retained', async () => {
  await request(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'gpt-4o-mini');
    return jsonResponse(completion());
  });
});

test('HTTP is allowed only for loopback, and credentials or query fragments are rejected', async () => {
  for (const baseUrl of ['http://localhost:1234/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1']) {
    await request(async () => jsonResponse(completion()), { baseUrl });
  }
  for (const baseUrl of [
    'http://example.test/v1', 'http://localhost.example.test/v1', 'ftp://localhost/v1',
    `https://${fakeSecret}@example.test/v1`, `https://user:${fakeSecret}@example.test/v1`,
    `https://example.test/v1?key=${fakeSecret}`, 'https://example.test/v1#fragment', fakeSecret,
  ]) {
    await rejectsSafely(() => request(() => assert.fail('invalid URL must not call fetch'), { baseUrl }), 'AI_INVALID_CONFIG');
  }
});

test('malformed completion JSON and malformed provider JSON have safe errors', async () => {
  await rejectsSafely(() => request(async () => jsonResponse(completion(`{${fakeSecret}`))), 'AI_INVALID_JSON');
  await rejectsSafely(() => request(async () => ({ ok: true, json: async () => { throw new SyntaxError(fakeSecret); } })), 'AI_INVALID_RESPONSE');
});

test('report requires strings, all fields, and one to three nonempty list items', async () => {
  const invalidReports = [
    null, [], {},
    { ...report, title: undefined }, { ...report, title: false }, { ...report, title: ' ' },
    { ...report, summary: { secret: fakeSecret } }, { ...report, summary: '\n' },
    { ...report, strengths: [] }, { ...report, strengths: [null] },
    { ...report, strengths: [{ secret: fakeSecret }] }, { ...report, strengths: [' '] },
    { ...report, risks: 'risk' }, { ...report, risks: ['a', 'b', 'c', 'd'] },
    { ...report, recommendations: [123] }, { ...report, recommendations: undefined },
  ];
  for (const invalid of invalidReports) {
    await rejectsSafely(() => request(async () => jsonResponse(completion(JSON.stringify(invalid)))), 'AI_INVALID_REPORT');
  }
});

test('report output respects existing display limits', async () => {
  const bounded = { title: 'a'.repeat(80), summary: 'b'.repeat(600), strengths: ['c'.repeat(280)], risks: ['r'], recommendations: ['x', 'y', 'z'] };
  assert.deepEqual(await request(async () => jsonResponse(completion(JSON.stringify(bounded)))), { ...bounded, source: 'ai' });
  for (const tooLong of [
    { ...bounded, title: 'a'.repeat(81) }, { ...bounded, summary: 'b'.repeat(601) },
    { ...bounded, strengths: ['c'.repeat(281)] },
  ]) {
    await rejectsSafely(() => request(async () => jsonResponse(completion(JSON.stringify(tooLong)))), 'AI_INVALID_REPORT');
  }
});

test('empty, nontext, refused and incomplete completions cannot be accepted as AI reports', async () => {
  for (const payload of [null, {}, { choices: [] }, completion(null), completion(''), completion(' '), completion({ secret: fakeSecret })]) {
    await rejectsSafely(() => request(async () => jsonResponse(payload)), 'AI_INVALID_RESPONSE');
  }
  await rejectsSafely(() => request(async () => jsonResponse(completion(null, {}, { refusal: fakeSecret }))), 'AI_REFUSAL');
  for (const finish_reason of ['length', 'content_filter', 'tool_calls', null, undefined]) {
    await rejectsSafely(() => request(async () => jsonResponse(completion(undefined, { finish_reason }))), 'AI_INCOMPLETE_RESPONSE');
  }
});

test('HTTP errors expose only safe status and never read the provider error body', async () => {
  for (const status of [401, 429, 500]) {
    await rejectsSafely(() => request(async () => ({
      ok: false, status, statusText: fakeSecret,
      json: async () => assert.fail('HTTP error body must not be read'),
    })), 'AI_HTTP_ERROR', status);
  }
});

test('network and timeout errors never expose underlying messages or causes', async () => {
  await rejectsSafely(() => request(async () => { throw new Error(fakeSecret); }), 'AI_NETWORK_ERROR');
  for (const name of ['TimeoutError', 'AbortError']) {
    const error = new Error(fakeSecret); error.name = name;
    await rejectsSafely(() => request(async () => { throw error; }), 'AI_TIMEOUT');
    await rejectsSafely(() => request(async () => ({ ok: true, json: async () => { throw error; } })), 'AI_TIMEOUT');
  }
});

test('invalid credentials, model and unserializable inputs fail safely without calling fetch', async () => {
  const fetchImpl = () => assert.fail('invalid request must not call fetch');
  for (const options of [{ apiKey: '' }, { apiKey: null }, { apiKey: `value\n${fakeSecret}` }, { model: '' }, { model: null }]) {
    await rejectsSafely(() => request(fetchImpl, options), 'AI_INVALID_CONFIG');
  }
  const cyclic = { secret: fakeSecret }; cyclic.self = cyclic;
  for (const input of [null, [], undefined, cyclic, { value: 1n }]) {
    await rejectsSafely(() => requestAiReport(input, { apiKey: fakeSecret, fetchImpl }), 'AI_INVALID_REQUEST');
  }
});
