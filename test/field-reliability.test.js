'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveFieldReliability, summarizeHistory } = require('../server.js');
const observation = (field, usable, status = usable ? 'healthy' : 'missing') => ({ field, usable, status });
const run = (id, observations, status = 'healthy') => ({ runId: id, status, fieldObservations: observations });
const allHealthy = (id) => run(id, ['product_name', 'price', 'description', 'rating', 'primary_image_url'].map((field) => observation(field, true)));

test('all required fields reach 100% with sufficient healthy evidence', () => {
  const result = deriveFieldReliability([allHealthy('1'), allHealthy('2'), allHealthy('3')]);
  assert.equal(result.length, 5); result.forEach((entry) => { assert.equal(entry.reliability, 100); assert.equal(entry.observedCount, 3); assert.equal(entry.sufficientEvidence, true); });
});
test('repeated degradation lowers only the affected field', () => {
  const runs = [run('1', [observation('price', false)]), run('2', [observation('price', false)])];
  const result = deriveFieldReliability(runs); const price = result.find((entry) => entry.field === 'price');
  assert.deepEqual(price, { field: 'price', reliability: null, observedCount: 2, usableCount: 0, degradedCount: 2, sufficientEvidence: false });
});
test('explicit missing observation counts as degraded evidence', () => { const result = deriveFieldReliability([run('1', [observation('price', false, 'missing')]), run('2', [observation('price', true)]), run('3', [observation('price', true)])]); assert.equal(result[0].field, 'price'); assert.equal(result[0].reliability, 67); assert.equal(result[0].degradedCount, 1); });
test('failed runs without observations and absent fields are excluded', () => { const result = deriveFieldReliability([run('1', [], 'failed'), run('2', [observation('price', true)]), run('3', [observation('price', true)])]); assert.equal(result[0].observedCount, 2); assert.equal(result[0].reliability, null); });
test('mixed evidence uses a per-field denominator', () => { const result = deriveFieldReliability([run('1', [observation('price', false), observation('rating', true)]), run('2', [observation('price', true), observation('rating', true)]), run('3', [observation('price', true)])]); assert.equal(result.find((entry) => entry.field === 'price').reliability, 67); assert.equal(result.find((entry) => entry.field === 'rating').reliability, null); });
test('zero, one, and two observations suppress reliability', () => { const result = deriveFieldReliability([run('1', [observation('price', true)]), run('2', [observation('description', false)])]); assert.equal(result.find((entry) => entry.field === 'price').reliability, null); assert.equal(result.find((entry) => entry.field === 'description').reliability, null); assert.deepEqual(deriveFieldReliability([]), []); });
test('ranking is deterministic with weakest first and tie-breaks', () => { const runs = [run('1', [observation('price', false), observation('rating', false), observation('description', true)]), run('2', [observation('price', true), observation('rating', false), observation('description', true)]), run('3', [observation('price', true), observation('rating', true), observation('description', true)])]; const result = deriveFieldReliability(runs); assert.deepEqual(result.map((entry) => entry.field), ['rating', 'price', 'description']); });
test('duplicate observations use the first explicit observation', () => { const result = deriveFieldReliability([run('1', [observation('price', false), observation('price', true)]), run('2', [observation('price', true)]), run('3', [observation('price', true)])]); assert.equal(result[0].reliability, 67); assert.equal(result[0].degradedCount, 1); });
test('legacy event-only history has no fabricated reliability', () => { assert.deepEqual(deriveFieldReliability([]), []); });
test('existing per-field degradation summary remains unchanged', () => { const summary = summarizeHistory({ runs: [run('1', [observation('price', false)])], events: [] }); assert.equal(summary.perFieldDegradationCount.price, 1); });
test('same input produces the same result', () => { const runs = [allHealthy('1'), allHealthy('2'), allHealthy('3')]; assert.deepEqual(deriveFieldReliability(runs), deriveFieldReliability(runs)); });
