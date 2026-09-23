import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scoreScenario, bestPlan } from '../src/shared/model.js';
const scenario = JSON.parse(fs.readFileSync(new URL('../data/scenario.json', import.meta.url), 'utf8'));
const valid = ['bus-priority', 'schoolyards', 'inclusive-school', 'street-light', 'service-desk'];
test('Shared starting budget is one billion KZT', () => {
  assert.equal(scenario.budget, 1_000_000_000);
  assert.equal(scenario.currency, 'KZT');
  assert.equal(scoreScenario(scenario, []).cost, 0);
  assert.equal(scoreScenario(scenario, []).change, 0);
});
test('Every accepted partial plan has an affordable completion in any choice order', () => {
  let checked = 0;
  function visit(ids, index) {
    if (index === scenario.dimensions.length) {
      let current; try { current = scoreScenario(scenario, ids); } catch { return; }
      const filled = new Set(current.selectedDimensions);
      const cheapest = scenario.dimensions.filter(d => !filled.has(d.id)).map(d =>
        scenario.initiatives.filter(i => i.dimension === d.id).sort((a,b) => a.cost-b.cost)[0].id);
      const complete = scoreScenario(scenario, [...ids, ...cheapest]);
      assert.equal(complete.complete, true); assert.ok(complete.remaining >= 0); checked++; return;
    }
    visit(ids, index+1);
    for (const item of scenario.initiatives.filter(i => i.dimension === scenario.dimensions[index].id)) visit([...ids,item.id],index+1);
  }
  visit([],0); assert.ok(checked > 243);
  assert.throws(() => scoreScenario(scenario,['mobility-hub','river-park']), /оставить/);
});
test('Budget cannot be exceeded, even with one project per direction', () => {
  assert.throws(() => scoreScenario(scenario, ['mobility-hub', 'river-park', 'clinic', 'safe-stops', 'one-window']), /Бюджет/);
});
test('Unknown, duplicate and malformed decisions are rejected', () => {
  for (const ids of [null, {}, ['unknown'], ['bus-priority', 'bus-priority'], ['bus-priority', 'mobility-hub']]) assert.throws(() => scoreScenario(scenario, ids));
});
test('Five decisions change the correct districts and conserve money', () => {
  const r = scoreScenario(scenario, valid);
  assert.equal(r.complete, true);
  assert.equal(r.cost, 850_000_000);
  assert.equal(r.remaining, 150_000_000);
  assert.equal(r.districts.find(d => d.id === 'almaty').projected.transport, 61);
  assert.equal(r.districts.find(d => d.id === 'yesil').projected.transport, 61);
  assert.ok(r.score > r.baselineScore);
  assert.notEqual(r.score, scoreScenario(scenario, ['safe-crossings', ...valid.slice(1)]).score);
});
test('Negative side effects are preserved and calculations are order independent', () => {
  const ids = ['mobility-hub', ...valid.slice(1)];
  const a = scoreScenario(scenario, ids),
    b = scoreScenario(scenario, [...ids].reverse());
  assert.equal(a.districts.find(d => d.id === 'yesil').projected.green, 64);
  assert.deepEqual(a.metrics, b.metrics);
  assert.equal(a.score, b.score);
});
test('Optimizer returns the best affordable displayed score over all 243 combinations', () => {
  const best = bestPlan(scenario);
  assert.equal(best.complete, true);
  assert.ok(best.cost <= scenario.budget);
  let count = 0;
  function visit(ids, index) {
    if (index === 5) {
      count++;
      try {
        const r = scoreScenario(scenario, ids);
        assert.ok(r.score <= best.score);
        if (r.score === best.score) assert.ok(r.cost >= best.cost);
      } catch (e) {
        if (!e.message.includes('Бюджет')) throw e;
      }
      return;
    }
    for (const item of scenario.initiatives.filter(i => i.dimension === scenario.dimensions[index].id)) visit([...ids, item.id], index + 1);
  }
  visit([], 0);
  assert.equal(count, 243);
});
