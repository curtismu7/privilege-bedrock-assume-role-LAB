import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import { installNetguard, netguardSelfTest } from '../src/netguard.js';
import { SCENARIOS, runScenario } from '../src/scenarios.js';
import { startLab } from './helpers.js';

test('self-test: every route out is refused and recorded, none reaches the network', async () => {
  const r = await netguardSelfTest();
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.blocked, 6);
  assert.match(r.detail, /fetch: blocked.*socket: blocked.*socket-ip: blocked.*dns: blocked.*dns-resolve: blocked.*udp: blocked/);
  installNetguard().restore();
});

test('a real outbound attempt is blocked and recorded; restore puts the real functions back', async () => {
  const before = net.Socket.prototype.connect;
  const g = installNetguard();
  assert.notEqual(net.Socket.prototype.connect, before);
  await assert.rejects(fetch('https://outbound.example.invalid/', { signal: AbortSignal.timeout(1500) }), /network blocked/);
  assert.deepEqual(g.attempts, ['fetch:outbound.example.invalid']);
  g.restore();
  assert.equal(net.Socket.prototype.connect, before);
});

test('ZERO outbound attempts while every scenario runs and the whole HTTP API is exercised', async () => {
  const g = installNetguard();
  const lab = await startLab();
  try {
    for (const s of SCENARIOS) runScenario(s.id);
    for (const s of SCENARIOS) assert.equal((await lab.send('POST', `/api/scenario/${s.id}`, {})).status, 200);
    await lab.get('/api/info'); await lab.get('/api/state'); await lab.get('/api/scenarios'); await lab.get('/api/health');
    await lab.send('POST', '/api/call', { prompt: 'hello world' });
    await lab.send('POST', '/api/call', { prompt: 'hello world', providerState: 'down' });
    await lab.send('POST', '/api/call', { prompt: 'hello', key: { mode: 'stored-credential', credential: 'MOCK-netguard-0001' } });
    await lab.send('POST', '/api/evaluate', { trust: '{"Version":"2012-10-17","Statement":[]}', permission: '{}' });
    await lab.send('POST', '/api/evaluate', { target: 'vertex', policy: { bindings: [] } });
    await lab.send('POST', '/api/mode', { source: 'real' });
    await lab.send('POST', '/api/reset', {});
    assert.deepEqual(g.attempts, [], 'no DNS, socket, fetch or UDP attempt left this machine');
  } finally { await lab.close(); g.restore(); }
});

test('a literal IP is allowed through the guarded lookup (an opted-in bind address needs no name server) but never connected to; names are still blocked', async () => {
  const g = installNetguard();
  try {
    const addr = await new Promise((res, rej) => dns.lookup('192.0.2.7', (e, a) => (e ? rej(e) : res(a))));
    assert.equal(addr, '192.0.2.7');
    assert.equal((await dns.promises.lookup('192.0.2.7')).address, '192.0.2.7');
    assert.deepEqual(g.attempts, [], 'a literal IP lookup is not an outbound attempt');
    await assert.rejects(new Promise((_, rej) => { try { const s = net.connect({ host: '192.0.2.7', port: 80 }); s.on('error', rej); } catch (e) { rej(e); } }), /network blocked/);
    assert.deepEqual(g.attempts, ['socket:192.0.2.7'], 'connecting to it is still refused and recorded');
    await assert.rejects(dns.promises.lookup('some-name.invalid'), /network blocked/);
    g.attempts.length = 0;
    // and a server can bind a non-loopback address of this machine when the bind is opted in
    const iface = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (iface) {
      const srv = net.createServer();
      await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, iface.address, res); });
      srv.close();
      assert.deepEqual(g.attempts, [], 'binding a literal non-loopback IP is not an outbound attempt');
    }
  } finally { g.restore(); }
});
