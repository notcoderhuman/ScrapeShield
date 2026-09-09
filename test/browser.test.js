'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

function createDom() {
  class Element {
    constructor(tag = 'div', id = '') { this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.textContent = ''; this.className = ''; this.style = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.dataset = {}; this.parentElement = { setAttribute: (key, value) => { this.attributes[key] = value; } }; }
    append(...items) { this.children.push(...items); this.textContent = this.children.map((item) => item.textContent || '').join(''); }
    appendChild(item) { this.append(item); return item; }
    replaceChildren(...items) { this.children = items; this.textContent = items.map((item) => item.textContent || '').join(''); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener() {}
    classList = { toggle: () => {}, add: () => {}, remove: () => {} };
    get lastChild() { return this.children[this.children.length - 1]; }
    get innerHTML() { return this.textContent; }
    set innerHTML(value) { this.textContent = value; }
  }
  const selectors = new Map();
  const ids = ['refresh-button','collector-id','checked-at','connection-label','health-panel','health-heading','health-icon','health-summary','health-score','score-fill','hero-usable','hero-risk','hero-last-success','hero-failures','op-last-run','op-health','op-recoveries','op-degraded','risk-count','risk-list','drift-list','field-list','diagnosis-status','diagnosis-list','image-frame','product-image','product-name','product-price','product-description','product-rating','payload-source','run-history','trend-view','field-history','history-list','timeline-list','demo-indicator','demo-indicator-text'];
  ids.forEach((id) => selectors.set(`#${id}`, new Element(id === 'product-image' ? 'img' : 'div', id)));
  selectors.set('.console-shell', new Element('main'));
  const buttons = ['live','healthy','degraded','failed'].map((mode) => { const button = new Element('button'); button.dataset.mode = mode; return button; });
  const document = { querySelector: (selector) => selectors.get(selector) || null, querySelectorAll: (selector) => selector === '.demo-btn' ? buttons : [], createElement: (tag) => new Element(tag), createElementNS: (namespace, tag) => new Element(tag), createTextNode: (text) => { const item = new Element('text'); item.textContent = String(text); return item; } };
  selectors.get('#refresh-button').addEventListener = () => {};
  selectors.get('#product-image').addEventListener = () => {};
  return { document, selectors };
}

async function executeApp(response) {
  const { document, selectors } = createDom();
  const context = { document, window: { location: { search: '?demo=' + response.demo, pathname: '/' }, history: { replaceState() {} } }, URLSearchParams, Set, Date, fetch: async () => ({ ok: true, json: async () => response }), console, Object, String, Array, Math, Number, Error, Promise, undefined };
  vm.runInNewContext(app, context);
  await new Promise((resolve) => setImmediate(resolve));
  return selectors;
}

function demoResponse(status) {
  const healthy = { field: 'product_name', present: true, observedType: 'string', observedShape: 'string', usable: true, status: 'healthy', reason: 'Field returned a usable value.' };
  const diagnostics = ['product_name','price','description','rating','primary_image_url'].map((field) => ({ ...healthy, field, ...(status === 'degraded' && field === 'price' ? { usable: false, status: 'null', observedType: 'null', reason: 'Field returned null.' } : {}) }));
  const usableFieldCount = status === 'healthy' ? 5 : status === 'degraded' ? 4 : 0;
  return { status, demo: status, collectorId: 'c_test', checkedAt: '2026-01-01T00:00:00.000Z', product: status === 'failed' ? null : { product_name: 'Test product' }, fieldDiagnostics: status === 'failed' ? [] : diagnostics, missingFields: status === 'degraded' ? ['price'] : status === 'failed' ? ['price'] : [], history: [], runHistory: [], latestRun: null, runHistorySummary: {}, healthScore: usableFieldCount * 20, usableFieldCount, monitoredFieldCount: 5, drift: [], recoveryEvent: null, ...(status === 'failed' ? { error: 'Demo failure' } : {}) };
}

test('dashboard contains live and all read-only demo controls', () => { for (const mode of ['live', 'healthy', 'degraded', 'failed']) assert.match(html, new RegExp(`data-mode="${mode}"`)); assert.match(app, /no live history modified/); });
test('dashboard consumes current reliability API fields', () => { for (const field of ['latestRun', 'runHistorySummary', 'fieldDiagnostics', 'drift', 'runHistory', 'recoveryEvent']) assert.match(app, new RegExp(field)); });
test('dashboard renders risk, drift, history, recovery, and trend empty states', () => { for (const phrase of ['Fields at risk', 'What changed', 'Run history', 'Recovery history', 'Health trend']) assert.match(html, new RegExp(phrase, 'i')); for (const phrase of ['No structured output changes detected', 'Run history will appear', 'Field history will appear']) assert.match(app, new RegExp(phrase)); });
test('responsive dashboard prevents horizontal overflow and supports narrow layouts', () => { assert.match(css, /@media\(max-width:560px\)/); assert.match(css, /@media\(max-width:340px\)/); assert.match(css, /box-sizing:border-box/); });
test('dashboard uses accessible landmarks and status semantics', () => { assert.match(html, /<main/); assert.match(html, /aria-label="Health score"/); assert.match(html, /role="status"/); assert.match(css, /:focus-visible/); });
for (const [status, expectedScore, expectedUsable] of [['healthy', '100/100', '5/5'], ['degraded', '80/100', '4/5'], ['failed', '0/100', '0/5']]) test(`rendering ${status} demo leaves loading state`, async () => { const selectors = await executeApp(demoResponse(status)); assert.equal(selectors.get('#health-heading').textContent, status.toUpperCase()); assert.equal(selectors.get('#collector-id').textContent, 'c_test'); assert.match(selectors.get('#checked-at').textContent, /Last checked/); assert.equal(selectors.get('#health-score').textContent, expectedScore); assert.equal(selectors.get('#hero-usable').textContent, expectedUsable); assert.equal(selectors.get('#field-list').children.length, 5); });
