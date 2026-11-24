import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaces, validWorkspace, MAX_WORKSPACES } from '../src/workspaces.js';
import { startLab } from './helpers.js';

test('workspaces: default exists, ids are validated, the cap spares the default, reset gives the slot back', () => {
  const ws = createWorkspaces({ build: (id) => ({ id }), max: 2 });
  assert.equal(ws.get().id, 'default');
  ws.get('a'); ws.get('b');
  ws.get('a'); // a is now the most recently used
  assert.equal(ws.get('c').id, 'c');
  assert.deepEqual(ws.ids().sort(), ['a', 'c', 'default'], 'the least recently used (b) was forgotten, never a refusal, and the default stays');
  ws.reset('a');
  assert.deepEqual(ws.ids().sort(), ['c', 'default']);
  for (const bad of ['', 'A', '-x', 'a'.repeat(33), 'a b', '__proto__', 5, null]) assert.equal(validWorkspace(bad), false, String(bad));
  assert.throws(() => ws.get('Bad Id'), (e) => e.code === 'bad_workspace');
  assert.equal(MAX_WORKSPACES, 20);
});

test('the key, the policies, the clock, the audit log and the last run are per workspace; Reset clears one only', async () => {
  const lab = await startLab();
  try {
    const w = (id) => ({ 'x-workspace': id });
    assert.equal((await lab.send('PUT', '/api/key', { mode: 'stored-credential', credential: 'MOCK-alpha-credential-1' }, w('alpha'))).status, 200);
    assert.equal((await lab.get('/api/state', w('alpha'))).json.key.mode, 'stored-credential');
    assert.equal((await lab.get('/api/state')).json.key.mode, 'assumed-role', 'the default workspace keeps its own key');
    await lab.send('POST', '/api/call', { prompt: 'hello there' }, w('alpha'));
    assert.equal((await lab.get('/api/state', w('alpha'))).json.clockMs, 400);
    assert.equal((await lab.get('/api/state')).json.clockMs, 0, 'the default clock did not move');
    assert.equal((await lab.get('/api/state')).json.auditSize, 0);
    assert.equal((await lab.get('/api/run-observability')).json.record, null, 'the default workspace has no run');
    assert.ok((await lab.get('/api/run-observability', w('alpha'))).json.record);
    assert.equal((await lab.get('/api/log', w('alpha'))).json.runs.length, 1);
    await lab.send('POST', '/api/call', { prompt: 'hello there' });
    const r = await lab.send('POST', '/api/reset', {}, w('alpha'));
    assert.equal(r.json.workspace, 'alpha'); assert.equal(r.json.key.mode, 'assumed-role', 'alpha is back to the default key');
    assert.equal((await lab.get('/api/run-observability', w('alpha'))).json.record, null);
    assert.equal((await lab.get('/api/log')).json.runs.length, 1, 'the default workspace was not reset');
    assert.equal((await lab.get('/api/info', w('alpha'))).json.workspace, 'alpha');
  } finally { await lab.close(); }
});

test('a malformed X-Workspace is a 400 with a message, never silently the default; past the cap the oldest workspace is forgotten, not a lock-out', async () => {
  const lab = await startLab();
  try {
    for (const bad of ['Bad Id', '../x', 'A', 'a'.repeat(40)]) {
      const r = await lab.get('/api/state', { 'x-workspace': bad });
      assert.deepEqual([r.status, r.json.error], [400, 'bad_workspace'], bad);
    }
    await lab.send('PUT', '/api/key', { mode: 'stored-credential', credential: 'MOCK-w0-credential-1' }, { 'x-workspace': 'w0' }); // w0 is the oldest
    for (let i = 1; i < MAX_WORKSPACES; i++) assert.equal((await lab.get('/api/state', { 'x-workspace': `w${i}` })).status, 200);
    assert.equal((await lab.get('/api/state', { 'x-workspace': 'one-too-many' })).status, 200, 'a new tab past the cap is admitted');
    assert.equal((await lab.get('/api/state', { 'x-workspace': 'w0' })).json.key.mode, 'assumed-role', 'the oldest workspace (w0) was forgotten: it starts fresh');
    assert.equal((await lab.get('/api/state')).status, 200, 'the default workspace is always admitted');
    assert.equal((await lab.send('POST', '/api/reset', {}, { 'x-workspace': 'w5' })).status, 200);
  } finally { await lab.close(); }
});

test('X-Workspace-Fresh: 1 on the request that CREATES a workspace; X-Workspace-Forgotten: 1 only when the tab said it had used the id (X-Workspace-Seen); routes with no workspace carry none', async () => {
  const lab = await startLab();
  try {
    const w = (id, seen) => ({ 'x-workspace': id, ...(seen ? { 'x-workspace-seen': '1' } : {}) });
    const first = await lab.get('/api/state', w('tab-a'));
    assert.deepEqual([first.headers.get('x-workspace-fresh'), first.headers.get('x-workspace-forgotten')], ['1', null], 'a brand-new tab: created, not forgotten');
    assert.deepEqual([(await lab.get('/api/state', w('tab-a', true))).headers.get('x-workspace-fresh'), 0], ['0', 0]);
    assert.equal((await lab.get('/api/info', w('tab-a'))).headers.get('x-workspace-fresh'), null);
    assert.equal((await lab.get('/api/state')).headers.get('x-workspace-fresh'), '1', 'the default workspace is created on first use too');
    // a reset starts the workspace again at once: the tab that reset it is never told it was forgotten
    const r = await lab.send('POST', '/api/reset', {}, w('tab-a', true));
    assert.equal(r.json.workspace, 'tab-a'); assert.equal(r.headers.get('x-workspace-fresh'), null);
    const after = await lab.get('/api/state', w('tab-a', true));
    assert.deepEqual([after.headers.get('x-workspace-fresh'), after.headers.get('x-workspace-forgotten')], ['0', null]);
    // evicted at the cap: tab-a is the least recently used of 20 others, a 21st pushes it out
    for (let i = 0; i < MAX_WORKSPACES; i++) await lab.get('/api/state', w(`other-${i}`));
    const gone = await lab.get('/api/state', w('tab-a', true));
    assert.deepEqual([gone.headers.get('x-workspace-fresh'), gone.headers.get('x-workspace-forgotten')], ['1', '1'], 'evicted: created again for a tab that had used it');
    const again = await lab.get('/api/state', w('tab-a', true));
    assert.deepEqual([again.headers.get('x-workspace-fresh'), again.headers.get('x-workspace-forgotten')], ['0', null], 'said once');
    // a Reset of an already-forgotten workspace is not "forgotten" either
    for (let i = 0; i < MAX_WORKSPACES; i++) await lab.get('/api/state', w(`more-${i}`));
    await lab.send('POST', '/api/reset', {}, w('tab-a', true));
    const post = await lab.get('/api/state', w('tab-a', true));
    assert.deepEqual([post.headers.get('x-workspace-fresh'), post.headers.get('x-workspace-forgotten')], ['0', null]);
  } finally { await lab.close(); }
});

test('a request that will be refused (400, 404, bad key, bad prompt, unknown scenario) validates BEFORE the workspace is touched: it creates nothing and evicts nobody', async () => {
  const lab = await startLab();
  try {
    const w = (id) => ({ 'x-workspace': id, 'x-workspace-seen': '1' });
    for (let i = 0; i < MAX_WORKSPACES; i++) await lab.get('/api/state', w(`keep-${i}`));
    const refused = [
      ['POST', '/api/call', { prompt: '' }], ['POST', '/api/call', { prompt: 'hi', key: { mode: 'nonsense' } }], ['POST', '/api/call', { prompt: 'hi', extra: 1 }],
      ['POST', '/api/call', { prompt: 'hi', advanceMs: -1 }], ['PUT', '/api/key', { mode: 'stored-credential', credential: 'not-mock' }], ['PUT', '/api/key', {}],
      ['POST', '/api/scenario/nope', {}],
    ];
    for (const [m, p, b] of refused) {
      const r = await lab.send(m, p, b, w('newcomer'));
      assert.ok(r.status === 400 || r.status === 404, `${m} ${p}: ${r.status}`);
      assert.equal(r.headers.get('x-workspace-fresh'), null, `${m} ${p} touched the workspace`);
    }
    for (let i = 0; i < MAX_WORKSPACES; i++) assert.equal((await lab.get('/api/state', w(`keep-${i}`))).headers.get('x-workspace-fresh'), '0', `keep-${i} was evicted by a refused request`);
    assert.equal((await lab.get('/api/state', w('newcomer'))).headers.get('x-workspace-fresh'), '1', 'the refused requests never created it');
    // a malformed workspace id is refused before anything happens
    assert.equal((await lab.get('/api/state', { 'x-workspace': 'Bad Id' })).status, 400);
  } finally { await lab.close(); }
});

test('least RECENTLY USED order: using a workspace keeps it, the one not used for longest is the one forgotten', () => {
  const ws = createWorkspaces({ build: (id) => ({ id }), max: 2 });
  ws.get('a'); ws.get('b'); ws.get('a'); ws.get('c');
  assert.deepEqual(ws.ids().filter((i) => i !== 'default').sort(), ['a', 'c']);
  assert.equal(ws.touch('b').created, true);
  assert.equal(ws.touch('b').created, false);
});
