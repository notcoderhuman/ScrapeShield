'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server.js');
const {
  CONFIG, SCHEMA_VERSION, isUsablePrice, validateProduct, observeField,
  detectDrift, createRun, normalizeHistory, detectRecovery, summarizeHistory, deriveIncidents,
} = require('../server.js');

const HEALTHY_PRODUCT = {
  product_name: 'Aurora Wireless Headphones',
  price: { value: 142.75, currency: 'USD', symbol: '$' },
  description: 'Over-ear wireless headphones.',
  rating: 4.6,
  primary_image_url: 'https://example.com/a.jpg',
};
const timestamp = '2026-01-01T00:00:00.000Z';

function run(overrides = {}) {
  return createRun({ runId: 'run-test', timestamp, status: 'healthy', product: HEALTHY_PRODUCT, collectorExecutionOutcome: 'completed', ...overrides });
}

test('a fully populated product is healthy and exposes all field observations', () => {
  const result = validateProduct(HEALTHY_PRODUCT);
  assert.equal(result.status, 'healthy');
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.fieldObservations.length, CONFIG.requiredFields.length);
  assert.equal(result.fieldObservations.find((field) => field.field === 'price').status, 'healthy');
});
test('missing field is observed precisely', () => {
  const result = validateProduct({ ...HEALTHY_PRODUCT, price: undefined });
  const observation = result.fieldObservations.find((field) => field.field === 'price');
  assert.equal(observation.present, true);
  assert.equal(observation.status, 'unexpected-type');
  const missing = validateProduct(Object.fromEntries(Object.entries(HEALTHY_PRODUCT).filter(([field]) => field !== 'price'))).fieldObservations.find((field) => field.field === 'price');
  assert.equal(missing.present, false);
  assert.equal(missing.status, 'missing');
});
test('null, empty, unexpected type, and unexpected shape are distinguished', () => {
  assert.equal(observeField('description', { description: null }).status, 'null');
  assert.equal(observeField('description', { description: '   ' }).status, 'empty');
  assert.equal(observeField('description', { description: 42 }).status, 'unexpected-type');
  assert.equal(observeField('price', { price: ['USD', 10] }).status, 'unexpected-type');
  assert.equal(observeField('price', { price: { currency: 'USD' } }).status, 'invalid');
});
test('a price object is only usable when it carries a value', () => {
  assert.equal(isUsablePrice({ value: 19.99, currency: 'USD', symbol: '$' }), true);
  assert.equal(isUsablePrice({ value: 0 }), true);
  assert.equal(isUsablePrice({ value: null, currency: 'USD' }), false);
  assert.equal(isUsablePrice({ currency: 'USD' }), false);
  assert.equal(isUsablePrice(null), false);
});
test('null price value is invalid and degrades only price', () => {
  const result = validateProduct({ ...HEALTHY_PRODUCT, price: { value: null, currency: 'USD' } });
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.missingFields, ['price']);
  assert.equal(result.fieldObservations.find((field) => field.field === 'price').status, 'invalid');
});

test('drift reports no changes for identical structured output', () => assert.deepEqual(detectDrift(HEALTHY_PRODUCT, HEALTHY_PRODUCT, timestamp), []));
test('drift detects removed and added fields', () => {
  const removed = { ...HEALTHY_PRODUCT }; delete removed.price;
  assert.equal(detectDrift(HEALTHY_PRODUCT, removed, timestamp)[0].type, 'field-removed');
  assert.equal(detectDrift(removed, { ...removed, price: HEALTHY_PRODUCT.price, extra: 'x' }, timestamp).some((change) => change.type === 'field-added'), true);
});
test('drift detects type, shape, usability, and null transitions', () => {
  assert.equal(detectDrift(HEALTHY_PRODUCT, { ...HEALTHY_PRODUCT, rating: '4.6' }, timestamp)[0].type, 'type-change');
  assert.equal(detectDrift(HEALTHY_PRODUCT, { ...HEALTHY_PRODUCT, price: { value: 142.75, currency: 'USD' } }, timestamp)[0].type, 'shape-change');
  assert.equal(detectDrift(HEALTHY_PRODUCT, { ...HEALTHY_PRODUCT, price: { value: null } }, timestamp)[0].type, 'null-transition');
  assert.equal(detectDrift({ ...HEALTHY_PRODUCT, description: '' }, HEALTHY_PRODUCT, timestamp)[0].type, 'usability-change');
});

test('run records retain minimal summaries and every health state', () => {
  const healthy = run();
  const degraded = run({ status: 'degraded', product: { ...HEALTHY_PRODUCT, price: null } });
  const failed = run({ status: 'failed', product: null, collectorExecutionOutcome: 'failed' });
  assert.equal(healthy.usableFieldCount, 5);
  assert.equal(degraded.usableFieldCount, 4);
  assert.equal(failed.collectorExecutionOutcome, 'failed');
  assert.equal(failed.fieldObservations.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(healthy, 'product'), false);
});
test('history normalization preserves old recovery events and adds schema version', () => {
  const old = { lastStatus: 'degraded', lastMissingFields: ['price'], events: [{ timestamp, previousStatus: 'degraded', currentStatus: 'healthy', recoveredFields: ['price'] }] };
  const history = normalizeHistory(old);
  assert.equal(history.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(history.events, old.events);
  assert.deepEqual(history.runs, []);
});
test('recovery from degraded uses exact prior field evidence', () => {
  const previous = run({ status: 'degraded', product: { ...HEALTHY_PRODUCT, price: null } });
  const event = detectRecovery({ lastStatus: 'degraded', lastMissingFields: ['price'], runs: [previous] }, 'healthy', timestamp, previous);
  assert.deepEqual(event.recoveredFields, ['price']);
});
test('failed to healthy makes no unsupported field claims', () => {
  const previous = run({ status: 'failed', product: null });
  assert.deepEqual(detectRecovery({ lastStatus: 'failed', lastMissingFields: [], runs: [previous] }, 'healthy', timestamp, previous).recoveredFields, []);
});
test('healthy to healthy and degraded to degraded do not recover', () => {
  const previous = run();
  assert.equal(detectRecovery({ lastStatus: 'healthy', runs: [previous] }, 'healthy', timestamp, previous), null);
  assert.equal(detectRecovery({ lastStatus: 'degraded', runs: [run({ status: 'degraded', product: { ...HEALTHY_PRODUCT, price: null } })] }, 'degraded', timestamp), null);
});
test('history summary calculates counts, streaks, and field recovery', () => {
  const degraded = run({ runId: 'd', status: 'degraded', product: { ...HEALTHY_PRODUCT, price: null } });
  const failed = run({ runId: 'f', status: 'failed', product: null });
  const healthy = run({ runId: 'h' });
  const summary = summarizeHistory({ runs: [degraded, failed, healthy], events: [{ timestamp }] });
  assert.equal(summary.lastSuccessfulRunAt, timestamp);
  assert.equal(summary.consecutiveFailures, 0);
  assert.equal(summary.degradationCount, 1);
  assert.equal(summary.failureCount, 1);
  assert.deepEqual(summary.currentFieldsAtRisk, []);
});
test('malformed history normalizes without crashing', () => {
  const history = normalizeHistory('{not-json');
  assert.deepEqual(history.runs, []);
  assert.deepEqual(history.events, []);
});

test('demo dashboard endpoints expose canonical scores and usable counts', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  for (const [mode, expectedStatus, expectedScore, expectedUsable] of [['healthy', 'healthy', 100, 5], ['degraded', 'degraded', 80, 4], ['failed', 'failed', 0, 0]]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard?demo=${mode}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, expectedStatus);
    assert.equal(body.demo, mode);
    assert.ok(Array.isArray(body.fieldDiagnostics));
    assert.ok(Array.isArray(body.runHistory));
    assert.equal(body.healthScore, expectedScore);
    assert.equal(body.usableFieldCount, expectedUsable);
  }
});
