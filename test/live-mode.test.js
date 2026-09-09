'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { app, CONFIG } = require('../server.js');

test('demo requests never mutate production history', async (t) => {
  const before = await fs.readFile(CONFIG.historyFile, 'utf8');
  const server = app.listen(0);
  t.after(async () => { server.close(); assert.equal(await fs.readFile(CONFIG.historyFile, 'utf8'), before); });
  const { port } = server.address();
  for (const mode of ['healthy', 'degraded', 'failed']) {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard?demo=${mode}`);
    assert.equal(response.status, 200);
  }
});

test('live persistence can use an ephemeral history file', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'scrapeshield-history-'));
  const temporaryHistory = path.join(temporaryDirectory, 'history.json');
  await fs.writeFile(temporaryHistory, JSON.stringify({ schemaVersion: 2, lastStatus: null, lastMissingFields: [], events: [], runs: [] }));
  const originalHistoryFile = CONFIG.historyFile;
  CONFIG.historyFile = temporaryHistory;
  const server = app.listen(0);
  t.after(async () => { server.close(); CONFIG.historyFile = originalHistoryFile; await fs.rm(temporaryDirectory, { recursive: true, force: true }); });
  const history = JSON.parse(await fs.readFile(temporaryHistory, 'utf8'));
  assert.deepEqual(history.runs, []);
});
