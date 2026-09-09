'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveIncidents } = require('../server.js');
const obs = (field, usable, status, reason = `${status} evidence`) => ({ field, usable, status, observedType: usable ? 'string' : status, reason });
const run = (id, timestamp, observations, status = 'degraded') => ({ runId: id, timestamp, status, fieldObservations: observations, drift: [] });

test('healthy to degraded creates one open incident and consecutive evidence stays grouped', () => {
  const incidents = deriveIncidents([
    run('1', '2026-01-01T00:00:00Z', [obs('price', false, 'null')]),
    run('2', '2026-01-01T00:01:00Z', [obs('price', false, 'null')]),
  ], []);
  assert.equal(incidents.length, 1); assert.equal(incidents[0].status, 'OPEN'); assert.equal(incidents[0].affectedRunCount, 2); assert.deepEqual(incidents[0].affectedFields, ['price']);
});
test('different field starts a separate incident and multi-field evidence is retained', () => {
  const incidents = deriveIncidents([run('1', '2026-01-01T00:00:00Z', [obs('price', false, 'null')]), run('2', '2026-01-01T00:01:00Z', [obs('rating', false, 'missing')])], []);
  assert.equal(incidents.length, 2); assert.deepEqual(incidents[1].affectedFields, ['rating']);
  const multi = deriveIncidents([run('3', '2026-01-01T00:02:00Z', [obs('price', false, 'null'), obs('rating', false, 'missing')])], []);
  assert.deepEqual(multi[0].affectedFields, ['price', 'rating']);
});
test('healthy run closes only when affected field is observed usable', () => {
  const incidents = deriveIncidents([run('1', '2026-01-01T00:00:00Z', [obs('price', false, 'null')]), run('2', '2026-01-01T00:02:00Z', [obs('price', true, 'healthy')], 'healthy')], []);
  assert.equal(incidents[0].status, 'RECOVERED'); assert.equal(incidents[0].recoveredAt, '2026-01-01T00:02:00Z');
  const unsupported = deriveIncidents([run('1', '2026-01-01T00:00:00Z', [obs('price', false, 'null')]), run('2', '2026-01-01T00:02:00Z', [], 'healthy')], []);
  assert.equal(unsupported[0].status, 'OPEN');
});
test('repeated degradation after recovery becomes recurring', () => {
  const incidents = deriveIncidents([run('1', '2026-01-01T00:00:00Z', [obs('price', false, 'null')]), run('2', '2026-01-01T00:01:00Z', [obs('price', true, 'healthy')], 'healthy'), run('3', '2026-01-01T00:03:00Z', [obs('price', false, 'null')])], []);
  assert.equal(incidents.length, 2); assert.equal(incidents[1].status, 'RECURRING'); assert.equal(incidents[1].recurrenceCount, 2);
});
test('failed without field evidence, empty history, and legacy events produce no incidents', () => {
  assert.deepEqual(deriveIncidents([], [{ timestamp: '2026-01-01T00:00:00Z' }]), []);
  assert.deepEqual(deriveIncidents([run('1', '2026-01-01T00:00:00Z', [], 'failed')], []), []);
});
test('incident derivation is deterministic', () => {
  const runs = [run('1', '2026-01-01T00:00:00Z', [obs('price', false, 'null')])];
  assert.deepEqual(deriveIncidents(runs, []), deriveIncidents(runs, []));
});
