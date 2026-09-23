import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3001);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'data/scenario.json'), 'utf8'));
const dimensions = new Set(scenario.dimensions.map((item) => item.id));
const initiativeById = new Map(scenario.initiatives.map((item) => [item.id, item]));

app.use(express.json({ limit: '32kb' }));

function scoreScenario(ids) {
  if (!Array.isArray(ids) || ids.length > scenario.dimensions.length) {
    throw new Error('Выберите не более пяти инициатив.');
  }
  const initiatives = ids.map((id) => initiativeById.get(id));
  if (initiatives.some((item) => !item)) throw new Error('В списке есть неизвестная инициатива.');
  const pickedDimensions = initiatives.map((item) => item.dimension);
  if (new Set(pickedDimensions).size !== pickedDimensions.length) {
    throw new Error('Можно выбрать только одну инициативу в каждом направлении.');
  }
  const cost = initiatives.reduce((total, item) => total + item.cost, 0);
  if (cost > scenario.budget) throw new Error('Бюджет превышен. Уберите или замените инициативу.');
  const districts = scenario.districts.map((district) => {
    const stats = { ...district.stats };
    initiatives.filter((item) => item.district === district.id).forEach((item) => {
      Object.entries(item.impact).forEach(([dimension, impact]) => {
        stats[dimension] = Math.max(0, Math.min(100, stats[dimension] + impact));
      });
    });
    return { ...district, projected: stats };
  });
  const metrics = Object.fromEntries(scenario.dimensions.map(({ id }) => {
    const baseline = scenario.districts.reduce((sum, district) => sum + district.stats[id] * district.population, 0) /
      scenario.districts.reduce((sum, district) => sum + district.population, 0);
    const projected = districts.reduce((sum, district) => sum + district.projected[id] * district.population, 0) /
      districts.reduce((sum, district) => sum + district.population, 0);
    return [id, { baseline: Math.round(baseline), projected: Math.round(projected), change: Math.round(projected - baseline) }];
  }));
  const baselineScore = scenario.dimensions.reduce((sum, { id }) => sum + metrics[id].baseline * scenario.weights[id], 0);
  const score = scenario.dimensions.reduce((sum, { id }) => sum + metrics[id].projected * scenario.weights[id], 0);
  return {
    selected: initiatives,
    selectedDimensions: [...pickedDimensions],
    cost,
    remaining: scenario.budget - cost,
    budget: scenario.budget,
    complete: initiatives.length === scenario.dimensions.length,
    baselineScore: Math.round(baselineScore * 10) / 10,
    score: Math.round(score * 10) / 10,
    change: Math.round((score - baselineScore) * 10) / 10,
    metrics,
    districts,
  };
}

function localAnalysis(result) {
  const impacts = scenario.dimensions.map(({ id, label }) => ({ label, ...result.metrics[id] }));
  const strengths = [...impacts].sort((a, b) => b.change - a.change).slice(0, 2);
  const risks = [...impacts].sort((a, b) => a.change - b.change).slice(0, 2);
  const percent = Math.round(result.cost / result.budget * 100);
  const leaders = strengths.filter((item) => item.change > 0).map((item) => `${item.label}: +${item.change} п.`);
  const weak = risks[0];
  const action = result.remaining >= 15
    ? `Осталось ${result.remaining} усл. ед.: рассмотрите замену одной из выбранных мер инициативой в направлении «${weak.label}», сохранив общий лимит.`
    : 'Резерв почти исчерпан. Сбалансируйте сценарий заменой одной из мер и сравните ожидаемый эффект для районов.';
  return {
    source: 'local',
    title: 'Разбор сценария',
    summary: `Сценарий повышает Astana Quality of Life Score на ${result.change} пункта и использует ${percent}% общего бюджета.`,
    strengths: leaders.length ? leaders : ['Распределение бюджета сохраняет исходные показатели города.'],
    risks: [weak.change < 0 ? `${weak.label}: снижение на ${Math.abs(weak.change)} п.` : `Наименьший прирост — в направлении «${weak.label}» (+${weak.change} п.).`, `Бюджетный резерв: ${result.remaining} усл. ед.`],
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
    budget: result.budget,
    spent: result.cost,
    remaining: result.remaining,
    initiatives: result.selected.map(({ title, cost, district }) => ({ title, cost, district })),
    metrics: scenario.dimensions.map(({ id, label }) => ({ label, ...result.metrics[id] })),
  };
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Ты аналитик симулятора городского управления. Отвечай на русском кратко и опирайся только на переданные цифры. Не меняй рассчитанный Score, не выдумывай причинность и факты. Укажи компромиссы и конкретные рекомендации. Верни JSON: {"title":string,"summary":string,"strengths":string[],"risks":string[],"recommendations":string[]}. Каждый список — 1–3 коротких пункта.' },
        { role: 'user', content: JSON.stringify(summaryData) },
      ],
    }),
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI response is empty');
  const resultJson = JSON.parse(text);
  for (const key of ['summary', 'strengths', 'risks', 'recommendations']) {
    if (!resultJson[key] || (key !== 'summary' && !Array.isArray(resultJson[key]))) throw new Error('AI response shape is invalid');
  }
  return { ...resultJson, source: 'ai' };
}

app.get('/api/scenario', (_req, res) => res.json(scenario));
app.post('/api/score', (req, res) => {
  try { res.json(scoreScenario(req.body?.selectedIds)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/analyze', async (req, res) => {
  try {
    const result = scoreScenario(req.body?.selectedIds);
    if (!result.complete) return res.status(400).json({ error: 'Завершите все пять решений перед анализом.' });
    try { res.json(await aiAnalysis(result)); }
    catch (error) {
      console.error('AI analysis unavailable:', error.message);
      res.json({ ...localAnalysis(result), aiUnavailable: true });
    }
  } catch (error) { res.status(400).json({ error: error.message }); }
});

if (fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}

app.listen(port, () => console.log(`City simulator API ready at http://localhost:${port}`));
