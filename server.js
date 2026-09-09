const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;
const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = 2;

const CONFIG = {
  collectorId: process.env.BRIGHT_DATA_COLLECTOR_ID || 'c_msx09cv3945korq8v',
  productUrl: 'https://shopalto.xyz/product/aurora-wireless-headphones',
  requiredFields: ['product_name', 'price', 'description', 'rating', 'primary_image_url'],
  historyFile: path.join(__dirname, 'data', 'healing-history.json'),
  demoProductFile: path.join(__dirname, 'data', 'demo-product.json'),
};
const DEMO_MODES = new Set(['healthy', 'degraded', 'failed']);
app.use(express.static(path.join(__dirname, 'public')));

function isUsable(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function isUsablePrice(price) {
  if (price && typeof price === 'object' && !Array.isArray(price)) return isUsable(price.value);
  return isUsable(price);
}
function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function valueShape(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return `object(${Object.keys(value).sort().join(',')})`;
  return typeof value;
}
function isExpectedType(field, value) {
  if (field === 'price') return !Array.isArray(value) && (typeof value === 'object' || isUsable(value));
  if (['product_name', 'description', 'primary_image_url'].includes(field)) return typeof value === 'string';
  if (field === 'rating') return typeof value === 'number' || typeof value === 'string';
  return true;
}
function observeField(field, product) {
  const present = Object.prototype.hasOwnProperty.call(product || {}, field);
  if (!present) return { field, present: false, observedType: undefined, observedShape: undefined, usable: false, status: 'missing', reason: 'Field was not returned by the collector.' };
  const value = product[field];
  const observedType = valueType(value);
  const observedShape = valueShape(value);
  if (value === null) return { field, present: true, observedType, observedShape, usable: false, status: 'null', reason: 'Field returned null.' };
  if (typeof value === 'string' && value.trim() === '') return { field, present: true, observedType, observedShape, usable: false, status: 'empty', reason: 'Field returned an empty value.' };
  if (!isExpectedType(field, value)) return { field, present: true, observedType, observedShape, usable: false, status: 'unexpected-type', reason: `Expected ${field === 'rating' ? 'a number or string' : 'a string'}.` };
  if (field === 'price' && value && typeof value === 'object' && !Array.isArray(value) && value.value === null) return { field, present: true, observedType, observedShape, usable: false, status: 'invalid', reason: 'Price value is null.' };
  if (field === 'price' && value && typeof value === 'object' && !Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value, 'value')) return { field, present: true, observedType, observedShape, usable: false, status: 'invalid', reason: 'Price object has no value.' };
  const usable = field === 'price' ? isUsablePrice(value) : isUsable(value);
  if (!usable) return { field, present: true, observedType, observedShape, usable: false, status: 'invalid', reason: 'Field returned an unusable value.' };
  return { field, present: true, observedType, observedShape, usable: true, status: 'healthy', reason: 'Field returned a usable value.' };
}
function observeProduct(product) { return CONFIG.requiredFields.map((field) => observeField(field, product)); }
function isFieldUsable(field, value) { return observeField(field, { [field]: value }).usable; }
function validateProduct(product) {
  const fieldObservations = observeProduct(product);
  const missingFields = fieldObservations.filter((observation) => !observation.usable).map((observation) => observation.field);
  return { missingFields, status: missingFields.length === 0 ? 'healthy' : 'degraded', fieldObservations };
}
function comparableObservation(field, product) {
  if (product?.[field] && typeof product[field] === 'object' && Object.prototype.hasOwnProperty.call(product[field], 'observedType')) return product[field];
  return observeField(field, product);
}
function detectDrift(previousProduct, currentProduct, timestamp) {
  if (!previousProduct || !currentProduct) return [];
  const fields = [...new Set([...Object.keys(previousProduct), ...Object.keys(currentProduct)])].sort();
  const changes = [];
  fields.forEach((field) => {
    const previous = comparableObservation(field, previousProduct);
    const current = comparableObservation(field, currentProduct);
    const previousExists = Object.prototype.hasOwnProperty.call(previousProduct, field);
    const currentExists = Object.prototype.hasOwnProperty.call(currentProduct, field);
    let type;
    if (!previousExists && currentExists) type = 'field-added';
    else if (previousExists && !currentExists) type = 'field-removed';
    else if (field === 'price' && previous.usable && current.observedType === 'object' && currentProduct[field]?.value === null) type = 'null-transition';
    else if (previous.status !== current.status && current.status === 'null') type = 'null-transition';
    else if (previous.observedType !== current.observedType) type = 'type-change';
    else if (previous.observedShape !== current.observedShape) type = 'shape-change';
    else if (previous.usable !== current.usable) type = 'usability-change';
    if (type) changes.push({ field, type, previous, current, observedAt: timestamp });
  });
  return changes;
}
function createRun({ runId, timestamp, status, product, collectorExecutionOutcome, previousRun }) {
  const validation = product ? validateProduct(product) : { missingFields: CONFIG.requiredFields, fieldObservations: [] };
  const usableFieldCount = validation.fieldObservations.filter((field) => field.usable).length;
  return {
    runId, timestamp, status, collectorExecutionOutcome,
    usableFieldCount, monitoredFieldCount: CONFIG.requiredFields.length,
    healthScore: Math.round((usableFieldCount / CONFIG.requiredFields.length) * 100),
    missingFields: validation.missingFields,
    fieldObservations: validation.fieldObservations,
    drift: product && previousRun?.productSummary ? detectDrift(previousRun.productSummary, product, timestamp) : [],
    productSummary: product ? Object.fromEntries(Object.keys(product).sort().map((field) => [field, comparableObservation(field, product)])) : null,
  };
}
function normalizeHistory(raw) {
  const history = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    lastStatus: history.lastStatus ?? null,
    lastMissingFields: Array.isArray(history.lastMissingFields) ? history.lastMissingFields : [],
    events: Array.isArray(history.events) ? history.events : [],
    runs: Array.isArray(history.runs) ? history.runs : [],
  };
}
function previousLiveRun(history) { return history.runs.length ? history.runs[history.runs.length - 1] : null; }
function detectRecovery(history, status, timestamp, previousRun = previousLiveRun(history)) {
  const previousStatus = previousRun?.status || history.lastStatus;
  const recoveredFields = previousRun?.fieldObservations?.filter((field) => !field.usable).map((field) => field.field)
    || (Array.isArray(history.lastMissingFields) ? history.lastMissingFields : []);
  if (status === 'healthy' && ['degraded', 'failed'].includes(previousStatus)) {
    return { timestamp, previousStatus, currentStatus: status, recoveredFields: previousStatus === 'failed' && !previousRun?.fieldObservations?.length ? [] : recoveredFields };
  }
  return null;
}
function summarizeHistory(history) {
  const runs = history.runs;
  const successful = runs.filter((run) => run.status === 'healthy');
  let consecutiveFailures = 0; let consecutiveDegradedRuns = 0;
  for (let index = runs.length - 1; index >= 0; index -= 1) { if (runs[index].status === 'failed') consecutiveFailures += 1; else break; }
  for (let index = runs.length - 1; index >= 0; index -= 1) { if (runs[index].status === 'degraded') consecutiveDegradedRuns += 1; else break; }
  const perFieldDegradationCount = {}; const perFieldRecoveryCount = {};
  runs.forEach((run, index) => {
    (run.fieldObservations || []).filter((field) => !field.usable).forEach((field) => { perFieldDegradationCount[field.field] = (perFieldDegradationCount[field.field] || 0) + 1; });
    const previous = runs[index - 1];
    (run.fieldObservations || []).filter((field) => field.usable && previous?.fieldObservations?.some((prior) => prior.field === field.field && !prior.usable)).forEach((field) => { perFieldRecoveryCount[field.field] = (perFieldRecoveryCount[field.field] || 0) + 1; });
  });
  const latest = runs[runs.length - 1];
  return {
    lastSuccessfulRunAt: successful.at(-1)?.timestamp || null,
    consecutiveFailures, consecutiveDegradedRuns,
    degradationCount: runs.filter((run) => run.status === 'degraded').length,
    failureCount: runs.filter((run) => run.status === 'failed').length,
    recoveryCount: history.events.length,
    currentFieldsAtRisk: latest?.fieldObservations?.filter((field) => !field.usable).map((field) => field.field) || [],
    perFieldDegradationCount, perFieldRecoveryCount,
  };
}
async function readHistory() {
  try { return normalizeHistory(JSON.parse(await fs.readFile(CONFIG.historyFile, 'utf8'))); }
  catch (error) { console.error('Could not read recovery history:', error.message); return normalizeHistory({}); }
}
async function writeHistory(history) { await fs.writeFile(CONFIG.historyFile, `${JSON.stringify(history, null, 2)}\n`); }
function parseCliJson(output) {
  const text = output.trim();
  try { return JSON.parse(text); } catch {}
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const opening = text[start]; const closing = opening === '{' ? '}' : ']'; let depth = 0; let inString = false; let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (inString) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') inString = false; }
      else if (character === '"') inString = true;
      else if (character === opening) depth += 1;
      else if (character === closing) { depth -= 1; if (depth === 0) { try { return JSON.parse(text.slice(start, end + 1)); } catch { break; } } }
    }
  }
  throw new Error('Bright Data CLI did not return valid JSON.');
}
async function runCollector() {
  if (!/^c_[a-zA-Z0-9]+$/.test(CONFIG.collectorId)) throw new Error('The configured Bright Data collector ID is invalid.');
  const bdataArgs = ['scraper', 'run', CONFIG.collectorId, CONFIG.productUrl, '--pretty'];
  const bdataCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'bdata';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `bdata ${bdataArgs.join(' ')}`] : bdataArgs;
  let stdout;
  try { ({ stdout } = await execFileAsync(bdataCommand, commandArgs, { timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 })); }
  catch { throw new Error('Bright Data CLI could not complete the collector run. Confirm its local login and retry.'); }
  const parsed = parseCliJson(stdout); const product = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!product || typeof product !== 'object' || Array.isArray(product)) throw new Error('Bright Data CLI returned no usable product result.');
  return product;
}
function responseData(history, extra = {}) { return { history: history.events, runHistory: history.runs, latestRun: history.runs.at(-1) || null, runHistorySummary: summarizeHistory(history), collectorId: CONFIG.collectorId, ...extra }; }

app.get('/api/dashboard', async (req, res) => {
  const demoMode = typeof req.query.demo === 'string' ? req.query.demo : null; const timestamp = new Date().toISOString();
  if (demoMode && DEMO_MODES.has(demoMode)) {
    const history = await readHistory();
    try {
      if (demoMode === 'failed') return res.json(responseData(history, { status: 'failed', product: null, missingFields: CONFIG.requiredFields, fieldDiagnostics: [], healthScore: 0, usableFieldCount: 0, monitoredFieldCount: CONFIG.requiredFields.length, drift: [], recoveryEvent: null, checkedAt: timestamp, demo: demoMode, error: 'Demo Mode: simulated collector failure.' }));
      const product = JSON.parse(await fs.readFile(CONFIG.demoProductFile, 'utf8')); if (demoMode === 'degraded') product.price = null;
      const validation = validateProduct(product); const usableFieldCount = validation.fieldObservations.filter((field) => field.usable).length;
      return res.json(responseData(history, { status: validation.status, product, missingFields: validation.missingFields, fieldDiagnostics: validation.fieldObservations, healthScore: Math.round((usableFieldCount / CONFIG.requiredFields.length) * 100), usableFieldCount, monitoredFieldCount: CONFIG.requiredFields.length, drift: [], recoveryEvent: null, checkedAt: timestamp, demo: demoMode }));
    } catch (error) { console.error('Demo dashboard run failed:', error.message); return res.status(500).json(responseData(history, { status: 'failed', product: null, missingFields: CONFIG.requiredFields, fieldDiagnostics: [], drift: [], recoveryEvent: null, checkedAt: timestamp, demo: demoMode, error: 'Demo fixture could not be loaded.' })); }
  }
  const history = await readHistory(); const previousRun = previousLiveRun(history);
  try {
    const product = await runCollector(); const validation = validateProduct(product); const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const run = createRun({ runId, timestamp, status: validation.status, product, collectorExecutionOutcome: 'completed', previousRun });
    const recoveryEvent = detectRecovery(history, validation.status, timestamp, previousRun); if (recoveryEvent) history.events.unshift(recoveryEvent);
    history.runs.push(run); history.lastStatus = validation.status; history.lastMissingFields = validation.missingFields; await writeHistory(history);
    return res.json(responseData(history, { status: validation.status, product, missingFields: validation.missingFields, fieldDiagnostics: validation.fieldObservations, drift: run.drift, recoveryEvent, checkedAt: timestamp }));
  } catch (error) {
    const message = error.message || 'Bright Data CLI execution failed.'; console.error('Dashboard run failed:', message);
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; const run = createRun({ runId, timestamp, status: 'failed', product: null, collectorExecutionOutcome: 'failed', previousRun });
    history.runs.push(run); history.lastStatus = 'failed'; history.lastMissingFields = []; await writeHistory(history).catch((historyError) => console.error('Could not save failed status:', historyError.message));
    return res.status(502).json(responseData(history, { status: 'failed', product: null, missingFields: CONFIG.requiredFields, fieldDiagnostics: [], drift: [], recoveryEvent: null, checkedAt: timestamp, error: message }));
  }
});

if (require.main === module) app.listen(PORT, () => console.log(`ScrapeShield is running at http://localhost:${PORT}`));
module.exports = { app, CONFIG, SCHEMA_VERSION, isUsable, isUsablePrice, isFieldUsable, observeField, observeProduct, validateProduct, detectDrift, createRun, normalizeHistory, detectRecovery, summarizeHistory };
