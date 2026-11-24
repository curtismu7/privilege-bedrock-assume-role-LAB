import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrace } from '../src/gatewayTrace.js';
import { exchangesFor } from '../src/runTrace.js';
import { itemsFor } from '../src/runObs.js';
import { HOP_IDS } from '../src/callPath.js';
import { SCENARIOS, runScenarioDetailed } from '../src/scenarios.js';
import { DEFAULT_PROMPT } from '../src/data.js';
import { startLab } from './helpers.js';

const exchangesOf = (s) => { const out = runScenarioDetailed(s.id); return { out, ex: exchangesFor(itemsFor(s.kind, out.detail), { prompt: s.prompt ?? s.calls?.[0]?.prompt ?? DEFAULT_PROMPT }) }; };

test('every scenario produces traces that pass assertTrace, all mock, every decision checked', () => {
  for (const s of SCENARIOS) {
    const { ex } = exchangesOf(s);
    assert.ok(ex.length >= 1, s.id);
    ex.forEach((e, i) => { assert.equal(e.step, i + 1); assert.deepEqual(assertTrace(e.trace), [], `${s.id} step ${e.step}`); assert.equal(e.trace.source, 'mock'); });
    for (const e of ex) for (const d of e.trace.decisions) assert.equal(d.basis, 'checked', `${s.id}: ${d.id}`);
  }
});

test('a call is traced over the SIX HOPS, in order, each pass, fail or skipped, and the hop outcomes match the scenario\'s hand-written expectation', () => {
  for (const s of SCENARIOS.filter((x) => x.kind === 'call')) {
    const { ex, out } = exchangesOf(s);
    const calls = ex.filter((e) => /^App to gateway/.test(e.title.replace(/^[^:]*: (?=App)/, '')));
    assert.equal(calls.length, s.calls.length, s.id);
    calls.forEach((e, i) => {
      assert.deepEqual(e.trace.decisions.map((d) => d.id), [...HOP_IDS], s.id);
      const want = s.expect.calls[i].hops.map((h) => ({ done: 'pass', failed: 'fail', skipped: 'skipped' })[h.split(':')[1]]);
      assert.deepEqual(e.trace.decisions.map((d) => d.outcome), want, `${s.id} call ${i + 1}`);
    });
    assert.equal(out.pass, true);
  }
});

test('the extra steps are real calls only: the role service when a role was assumed, Bedrock when it was invoked; a reused session makes no assume call', () => {
  const by = Object.fromEntries(SCENARIOS.map((s) => [s.id, exchangesOf(s).ex]));
  assert.equal(by.success.length, 3);
  assert.match(by.success[1].title, /role assumed/); assert.match(by.success[2].title, /Bedrock: answered/);
  assert.equal(by['wrong-trust-principal'].length, 2, 'refused at the role service, no Bedrock call');
  assert.match(by['wrong-trust-principal'][1].title, /refused \(trust_principal_mismatch\)/);
  assert.equal(by['guard-still-applies'].length, 1, 'blocked by the guard before any role was assumed');
  assert.match(by['missing-invoke-permission'][2].title, /refused \(permission_missing_invoke\)/);
  assert.equal(by['expired-session-refreshed'].length, 6, 'two calls, each with its own assume and invoke');
});

test('a stored-credential key makes no role-service call; the trace says its credential is not shown', () => {
  const s = SCENARIOS.find((x) => x.id === 'stored-vs-assumed-key-shape');
  const { ex } = exchangesOf(s);
  const text = JSON.stringify(ex);
  assert.ok(ex.some((e) => /Stored-credential key: App to gateway/.test(e.title)));
  assert.doesNotMatch(text, /MOCK-scenario-credential-0001/, 'the stored value never appears in a trace');
  assert.ok(!ex.filter((e) => /Stored-credential/.test(e.title)).length || ex.filter((e) => /role service/.test(e.title)).length === 1, 'only the assumed-role key called the role service');
});

test('nothing secret and nothing real in a trace: .example hosts, labelled mock credentials, the external ID is never shown, no token-shaped value', () => {
  for (const s of SCENARIOS) {
    const text = JSON.stringify(exchangesOf(s).ex);
    for (const m of text.matchAll(/https?:\/\/([^/"\\]+)/g)) assert.match(m[1], /\.example$/, m[1]);
    assert.doesNotMatch(text, /example-external-id-000\d/);
    assert.doesNotMatch(text, /eyJ[\w-]{8,}\.|sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}/);
  }
  assert.match(JSON.stringify(exchangesOf(SCENARIOS[0]).ex), /a lab mock value, not a credential/);
});

test('the API returns the trace and the verdict with a call and a scenario', async () => {
  const lab = await startLab();
  try {
    const call = (await lab.send('POST', '/api/call', { prompt: 'hello there', providerState: 'overloaded' })).json;
    assert.equal(call.code, 'provider_overloaded'); assert.equal(call.verdict.code, 'provider_overloaded');
    assert.equal(call.trace.exchanges.at(-1).status, 429);
    const sc = (await lab.send('POST', '/api/scenario/vertex-without-role', {})).json;
    assert.equal(sc.verdict.code, 'vertex_role_missing'); assert.equal(sc.trace.exchanges.length, 1);
    assert.equal((await lab.send('POST', '/api/scenario/success', {})).json.verdict.title, 'Role assumed, call allowed');
  } finally { await lab.close(); }
});
