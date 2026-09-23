export function scoreScenario(scenario, ids) {
  if (!Array.isArray(ids) || ids.length > scenario.dimensions.length) throw new Error('Выберите не более пяти инициатив.');
  const selected = ids.map(id => scenario.initiatives.find(item => item.id === id));
  if (selected.some(item => !item)) throw new Error('Неизвестная инициатива.');
  const selectedDimensions = selected.map(item => item.dimension);
  if (new Set(selectedDimensions).size !== selected.length) throw new Error('Выберите только одну инициативу в каждом направлении.');
  const cost = selected.reduce((sum, item) => sum + item.cost, 0);
  if (cost > scenario.budget) throw new Error('Бюджет превышен. Замените одну из инициатив.');
  const reserved = scenario.dimensions.filter(d => !selectedDimensions.includes(d.id))
    .reduce((sum, d) => sum + Math.min(...scenario.initiatives.filter(i => i.dimension === d.id).map(i => i.cost)), 0);
  if (cost + reserved > scenario.budget) throw new Error(`Нужно оставить ${new Intl.NumberFormat('ru-RU').format(reserved)} ₸ на оставшиеся направления. Выберите более доступный проект.`);
  const districts = scenario.districts.map(district => {
    const projected = {
      ...district.stats
    };
    for (const item of selected.filter(item => item.district === district.id)) {
      for (const [key, value] of Object.entries(item.impact)) projected[key] += value;
    }
    for (const key of Object.keys(projected)) projected[key] = Math.max(0, Math.min(100, projected[key]));
    return {
      ...district,
      projected
    };
  });
  const population = districts.reduce((sum, item) => sum + item.population, 0);
  const round = value => Math.round(value * 10) / 10;
  let base = 0,
    total = 0;
  const metrics = Object.fromEntries(scenario.dimensions.map(({
    id
  }) => {
    const baseline = districts.reduce((sum, d) => sum + d.stats[id] * d.population, 0) / population;
    const projected = districts.reduce((sum, d) => sum + d.projected[id] * d.population, 0) / population;
    base += baseline * scenario.weights[id];
    total += projected * scenario.weights[id];
    return [id, {
      baseline: round(baseline),
      projected: round(projected),
      change: round(projected - baseline)
    }];
  }));
  return {
    selected,
    selectedDimensions,
    cost,
    remaining: scenario.budget - cost,
    reserved,
    flexible: scenario.budget - cost - reserved,
    budget: scenario.budget,
    complete: selected.length === scenario.dimensions.length,
    baselineScore: round(base),
    score: round(total),
    change: round(total - base),
    metrics,
    districts
  };
}
export function bestPlan(scenario) {
  let best;
  function visit(ids, index, cost) {
    if (index === scenario.dimensions.length) {
      const result = scoreScenario(scenario, ids);
      if (!best || result.score > best.score || result.score === best.score && result.cost < best.cost) best = result;
      return;
    }
    for (const item of scenario.initiatives.filter(item => item.dimension === scenario.dimensions[index].id)) {
      if (cost + item.cost <= scenario.budget) visit([...ids, item.id], index + 1, cost + item.cost);
    }
  }
  visit([], 0, 0);
  return best;
}
