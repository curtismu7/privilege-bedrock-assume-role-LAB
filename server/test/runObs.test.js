import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunObservability, LAYERS, classify, defaultLayers } from '../src/runObservability.js';
import { buildRunRecord, decisionLine, durationMs, eventsFor, itemsFor, mockLayers } from '../src/runObs.js';
import { SCENARIOS, runScenarioDetailed } from '../src/scenarios.js';
import { createLab } from '../src/lab.js';
import { DEFAULT_PROMPT } from '../src/data.js';
import { startLab } from './helpers.js';

const BASE = Date.parse('2026-11-24T10:00:00.000Z');
const FORBIDDEN_WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served/i;

const recordFor = async (id) => {
  const out = runScenarioDetailed(id);
  const items = itemsFor(out.kind, out.detail);
  const events = eventsFor(items, { baseMs: BASE });
  const run = { id: 'run-1', startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE + durationMs(items)).toISOString(), events, items };
  return { record: await buildRunRecord(run, { clock: () => BASE }), events, out, items };
};

test('every scenario leaves a record that passes the shared assertRunObservability, all rows simulated, all six layers named', async () => {
  for (const s of SCENARIOS) {
    const { record } = await recordFor(s.id);
    assert.deepEqual(assertRunObservability(record), [], s.id);
    assert.equal(record.source, 'mock');
    assert.ok(record.rows.length >= 3, s.id);
    assert.deepEqual(Object.keys(record.coverage).sort(), [...LAYERS].sort(), s.id);
    for (const r of record.rows) assert.ok(r.origin === 'simulated' || r.origin === 'not-logged', `${s.id}: ${r.origin}`);
    for (const l of ['person', 'gateway']) assert.equal(record.coverage[l], 'not-logged', `${s.id}: ${l} has nothing and says so`);
    assert.ok(record.reasons.person && record.reasons.gateway, 'a layer with nothing says why');
  }
});

test('the rows say what happened: a served call is allowed through every step, a role refusal is refused, a guard block is blocked, nothing is invented', async () => {
  const ok = await recordFor('success');
  assert.ok(ok.record.rows.every((r) => r.outcome !== 'refused' && r.outcome !== 'blocked'));
  assert.ok(ok.record.rows.some((r) => r.layer === 'authorize' && r.outcome === 'allowed' && /Role assumed/.test(r.message)));
  assert.equal(ok.record.rows.filter((r) => r.layer === 'resource').length, 1, 'one provider call, one reply');
  assert.ok(ok.record.rows.some((r) => /Audit entry 1 written/.test(r.message)), 'the audit entry is part of the run');
  const wrong = await recordFor('wrong-trust-principal');
  assert.ok(wrong.record.rows.some((r) => r.outcome === 'refused' && /Wrong trust principal/.test(r.message)));
  assert.equal(wrong.record.coverage.resource, 'not-logged', 'no model was called');
  assert.match(wrong.record.reasons.resource, /No model was called/);
  assert.ok(wrong.record.rows.some((r) => /Audit entry 1 written \(refused/.test(r.message)), 'a refusal is audited');
  const guard = await recordFor('guard-still-applies');
  assert.ok(guard.record.rows.some((r) => r.outcome === 'blocked' && /AI Guard/.test(r.message)));
  assert.ok(!guard.record.rows.some((r) => r.layer === 'authorize' && r.origin === 'simulated'), 'no role was assumed, so no IAM decision row');
  const perm = await recordFor('missing-invoke-permission');
  assert.ok(perm.record.rows.some((r) => r.layer === 'authorize' && r.outcome === 'allowed' && /Role assumed/.test(r.message)));
  assert.ok(perm.record.rows.some((r) => r.layer === 'authorize' && r.outcome === 'refused' && /Invoke refused: Missing invoke permission/.test(r.message)));
  const stored = await recordFor('stored-vs-assumed-key-shape');
  assert.ok(stored.record.rows.some((r) => /masked; never shown or logged/.test(r.message)));
  const vertex = await recordFor('vertex-without-role');
  assert.ok(vertex.record.rows.some((r) => r.layer === 'authorize' && r.outcome === 'refused' && /no role/i.test(r.message)));
});

test('row times are the stdout line times: one stamp per event, in time order, never in the future of the run\'s end, idle clock time is not added', async () => {
  const { record, events, items } = await recordFor('expired-session-refreshed');
  const times = record.rows.filter((r) => r.at).map((r) => r.at);
  assert.deepEqual(times, [...times].sort(), 'rows are in time order');
  assert.ok(events.every((e) => record.rows.some((r) => r.at === e.at)));
  const last = events.map((e) => Date.parse(e.at)).sort((a, b) => a - b).at(-1);
  assert.equal(last - BASE, durationMs(items));
  assert.equal(durationMs(items), 800, 'two 400 ms calls; the hour the clock was advanced is not run time');
});

test('the stdout line: one per decision, loopless vocabulary, a hostile name cannot forge a second field or a second line', () => {
  const e = { at: '2026-11-24T10:00:00.000Z', step: 'assume-role', actor: 'lab-mock-iam', outcome: 'refused' };
  assert.equal(decisionLine(e, 'run-3'), '2026-11-24T10:00:00.000Z privilege-bedrock-assume-role-lab decision step=assume-role actor=lab-mock-iam result=stopped run=run-3');
  const hostile = decisionLine({ ...e, actor: 'x result=passed\nrun=evil\r\n2026 forged line', step: 'a b' }, 'run 1\n');
  assert.ok(!/[\r\n]/.test(hostile));
  assert.equal(hostile.split(' ').filter((w) => w.startsWith('result=')).length, 1);
  assert.equal((hostile.match(/ run=/g) || []).length, 1);
});

test('no stdout line uses a word a shared matcher reads as a decision, and none is classified as a product line', async () => {
  const lines = [];
  for (const s of SCENARIOS) for (const e of (await recordFor(s.id)).events) lines.push(decisionLine(e, 'run-1').replace(/^\S+ privilege-bedrock-assume-role-lab /, ''));
  assert.ok(lines.length > 40);
  for (const l of lines) assert.doesNotMatch(l, FORBIDDEN_WORDS, l);
  for (const l of lines) assert.equal(classify(`2026-11-24T10:00:00.000Z privilege-bedrock-assume-role-lab ${l}`), null, l);
});

test('no row and no stdout line holds the prompt, an external ID or a credential value', async () => {
  for (const s of SCENARIOS) {
    const { record, events } = await recordFor(s.id);
    const text = JSON.stringify([record.rows, events.map((e) => decisionLine(e, 'run-1'))]);
    assert.doesNotMatch(text, /example-external-id-000\d|MOCK-scenario-credential|Summarise the open support cases/, s.id);
  }
});

test('the lab reads no logs: only the collector core is vendored, and the layers carry only simulated rows', () => {
  const out = runScenarioDetailed('success');
  const layers = mockLayers(eventsFor(itemsFor(out.kind, out.detail), { baseMs: BASE }));
  assert.deepEqual(layers.map((l) => l.layer), [...LAYERS]);
  assert.ok(layers.every((l) => l.products.length === 0 && !l.responses), 'no product reader and no API response row');
  assert.ok(defaultLayers().length > 0);
});

test('API: /api/run-observability is null before any run; a live call and a scenario run each leave their record; the stdout lines match the rows', async () => {
  const lines = [];
  const lab = await startLab({ log: (l) => lines.push(l), now: () => BASE });
  try {
    const empty = (await lab.get('/api/run-observability')).json;
    assert.equal(empty.record, null); assert.ok(empty.streams.length >= 2);
    const run = (await lab.send('POST', '/api/call', { prompt: 'summarise the open cases' })).json;
    assert.match(run.runId, /^run-\d+$/);
    const live = (await lab.get('/api/run-observability')).json;
    assert.equal(live.run.kind, 'live'); assert.equal(live.record.runId, run.runId);
    assert.deepEqual(assertRunObservability(live.record), []);
    assert.equal(lines.length, live.record.rows.filter((r) => r.origin === 'simulated').length, 'one stdout line per simulated row');
    for (const r of live.record.rows.filter((x) => x.origin === 'simulated')) assert.ok(lines.some((l) => l.startsWith(r.at)), r.message);
    const sc = (await lab.send('POST', '/api/scenario/success', {})).json;
    const after = (await lab.get('/api/run-observability')).json;
    assert.equal(after.run.kind, 'scenario'); assert.equal(after.run.scenarioId, 'success'); assert.equal(after.record.runId, sc.runId);
    assert.equal((await lab.get('/api/state')).json.key.budget.spent, 124, 'the scenario did not touch the live key: only the live call charged it');
    assert.equal((await lab.get('/api/log')).json.runs.length, 2);
    assert.equal((await lab.send('POST', '/api/run-observability', {})).status, 405);
  } finally { await lab.close(); }
});

test('a refused prompt leaves no run behind (nothing was decided)', async () => {
  const lab = await startLab();
  try {
    assert.equal((await lab.send('POST', '/api/call', { prompt: '' })).status, 400);
    assert.equal((await lab.get('/api/run-observability')).json.record, null);
    assert.equal((await lab.get('/api/log')).json.runs.length, 0);
  } finally { await lab.close(); }
});

test('the run log is bounded', async () => {
  const lab = await startLab();
  try {
    for (let i = 0; i < 25; i++) await lab.send('POST', '/api/scenario/success', {});
    assert.equal((await lab.get('/api/log')).json.runs.length, 20);
    assert.equal((await lab.get('/api/log')).json.runs[0].runId, 'run-25');
  } finally { await lab.close(); }
});

test('an empty layer gives a reason built from the run: it names no mechanism that did not happen', async () => {
  const reasons = async (id) => (await recordFor(id)).record.reasons;
  const vertex = await reasons('vertex-with-role');
  assert.match(vertex.resource, /Vertex AI policy/); assert.doesNotMatch(vertex.resource, /mock Bedrock|stopped before/);
  const guard = await reasons('guard-still-applies');
  assert.match(guard.authorize, /AI Guard stub blocked the call before any role was assumed/); assert.doesNotMatch(guard.authorize, /stored-credential/);
  assert.match(guard.resource, /AI Guard stub blocked the call/); assert.doesNotMatch(guard.resource, /mock Bedrock/);
  const refused = await reasons('wrong-trust-principal');
  assert.match(refused.resource, /refused before the mock Bedrock/);
  // a stored-credential run: its Authorize layer says so
  const lab = createLab({ key: { mode: 'stored-credential', credential: 'MOCK-reason-0001' } });
  const call = lab.call(DEFAULT_PROMPT);
  const items = itemsFor('call', { calls: [call] });
  const rec = await buildRunRecord({ id: 'run-1', startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE).toISOString(), events: eventsFor(items, { baseMs: BASE }), items }, { clock: () => BASE });
  assert.match(rec.reasons.authorize, /stored-credential key: no role is assumed/);
  assert.equal(rec.reasons.resource, undefined, 'the call reached the mock Bedrock, so that layer has rows and needs no reason');
  // the same layer for an assumed-role run never says stored-credential
  const lab2 = createLab(); const call2 = lab2.call(`please ${'[[guard-block]]'}`);
  const items2 = itemsFor('call', { calls: [call2] });
  const rec2 = await buildRunRecord({ id: 'run-2', startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE).toISOString(), events: eventsFor(items2, { baseMs: BASE }), items: items2 }, { clock: () => BASE });
  assert.doesNotMatch(rec2.reasons.authorize, /stored-credential/);
  // through the API the live record carries the same reasons
  const api = await startLab();
  try {
    await api.send('POST', '/api/call', { prompt: 'x [[guard-block]]' });
    const j = (await api.get('/api/run-observability')).json;
    assert.match(j.record.reasons.authorize, /AI Guard stub blocked/);
  } finally { await api.close(); }
});
