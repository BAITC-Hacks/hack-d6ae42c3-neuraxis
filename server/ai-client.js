const ERROR_MESSAGES = Object.freeze({
  AI_INVALID_CONFIG: 'AI configuration is invalid',
  AI_INVALID_REQUEST: 'AI request is invalid',
  AI_HTTP_ERROR: 'AI provider returned an HTTP error',
  AI_NETWORK_ERROR: 'AI provider request failed',
  AI_TIMEOUT: 'AI provider request timed out',
  AI_INVALID_RESPONSE: 'AI provider response is invalid',
  AI_REFUSAL: 'AI provider declined the request',
  AI_INCOMPLETE_RESPONSE: 'AI provider response is incomplete',
  AI_INVALID_JSON: 'AI report is not valid JSON',
  AI_INVALID_REPORT: 'AI report shape is invalid',
});

export class AiError extends Error {
  constructor(code, status) {
    const safeCode = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'AI_INVALID_RESPONSE';
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
    super(`${ERROR_MESSAGES[safeCode]}${safeStatus === undefined ? '' : ` (${safeStatus})`}`);
    this.name = 'AiError';
    this.code = safeCode;
    if (safeStatus !== undefined) this.status = safeStatus;
  }
}

const SYSTEM_PROMPT = 'Ты аналитик симулятора городского управления. Все денежные суммы в казахстанских тенге (₸). Отвечай на русском кратко и опирайся только на переданные цифры. Не меняй рассчитанный Score, не выдумывай причинность и факты. Укажи компромиссы и конкретные рекомендации. Верни JSON: {"title":string,"summary":string,"strengths":string[],"risks":string[],"recommendations":string[]}. Заголовок — до 80 символов, описание — до 600 символов. Каждый список — 1–3 непустых коротких пункта, каждый до 280 символов.';

function completionUrl(baseUrl) {
  try {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new AiError('AI_INVALID_CONFIG');
    const url = new URL(baseUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash) {
      throw new AiError('AI_INVALID_CONFIG');
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
    return url.toString();
  } catch {
    throw new AiError('AI_INVALID_CONFIG');
  }
}

function reportString(value, maxLength) {
  if (typeof value !== 'string') throw new AiError('AI_INVALID_REPORT');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new AiError('AI_INVALID_REPORT');
  return trimmed;
}

function reportList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new AiError('AI_INVALID_REPORT');
  return value.map(item => reportString(item, 280));
}

function sanitizeReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new AiError('AI_INVALID_REPORT');
  return {
    title: reportString(report.title, 80),
    summary: reportString(report.summary, 600),
    strengths: reportList(report.strengths),
    risks: reportList(report.risks),
    recommendations: reportList(report.recommendations),
    source: 'ai',
  };
}

export async function requestAiReport(summaryData, {
  apiKey,
  model = 'gpt-4o-mini',
  baseUrl = 'https://api.openai.com/v1',
  fetchImpl = fetch,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)
    || typeof model !== 'string' || !model.trim() || typeof fetchImpl !== 'function') {
    throw new AiError('AI_INVALID_CONFIG');
  }
  const url = completionUrl(baseUrl);
  let body;
  try {
    const content = JSON.stringify(summaryData);
    if (!content || !summaryData || typeof summaryData !== 'object' || Array.isArray(summaryData)) {
      throw new AiError('AI_INVALID_REQUEST');
    }
    body = JSON.stringify({
      model,
      temperature: 0.4,
      max_completion_tokens: 1200,
      store: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    });
  } catch {
    throw new AiError('AI_INVALID_REQUEST');
  }
  const signal = AbortSignal.timeout(18000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
      redirect: 'error',
      signal,
    });
  } catch (error) {
    const timedOut = signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new AiError(timedOut ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR');
  }
  if (!response || typeof response.ok !== 'boolean' || typeof response.json !== 'function') {
    throw new AiError('AI_INVALID_RESPONSE');
  }
  if (!response.ok) throw new AiError('AI_HTTP_ERROR', response.status);
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    const timedOut = signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new AiError(timedOut ? 'AI_TIMEOUT' : 'AI_INVALID_RESPONSE');
  }
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
  const message = choice?.message;
  if (message?.refusal != null && message.refusal !== '') throw new AiError('AI_REFUSAL');
  if (!choice || !message || typeof message.content !== 'string' || !message.content.trim()) {
    throw new AiError('AI_INVALID_RESPONSE');
  }
  if (choice.finish_reason !== 'stop') throw new AiError('AI_INCOMPLETE_RESPONSE');
  let report;
  try {
    report = JSON.parse(message.content);
  } catch {
    throw new AiError('AI_INVALID_JSON');
  }
  return sanitizeReport(report);
}
