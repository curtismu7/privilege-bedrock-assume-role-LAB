import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANNER, UNVERIFIED } from '../src/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    if (['node_modules', '.git'].includes(n)) continue;
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
  }
})(ROOT);
const ATTRIBUTION = new RegExp(['Co-Authored-', 'By|Generated', ' with|claude\\.com/claude', '-code'].join(''), 'i'); // built from parts so this file does not match itself
const text = (p) => fs.readFileSync(p, 'utf8');
// The CI workflow names the CI tool's download host, and the shared check script names the patterns it searches for: both are skipped.
const isWorkflow = (p) => p.includes(`${path.sep}.github${path.sep}`);
const mine = files.filter((p) => !p.endsWith('package-lock.json') && !p.endsWith('.sha256') && !p.endsWith('check-no-ai-attribution.sh') && !isWorkflow(p) && !p.includes(`${path.sep}web${path.sep}dist${path.sep}`));
// Files copied byte for byte from the family's shared components (each pinned by its own test) or from a shared tool: their text is not this lab's.
const VENDORED = [/web\/src\/(diagram-kit|top-menu|floating-dialog|gateway-trace|run-observability|talk-track)\//, /web\/src\/components\/(JsonPane|jsonpane)/, /web\/src\/standalone-ui\.css$/,
  /server\/src\/(gatewayTrace|runObservability|diagramStudioValidate|health)\.js$/, /scripts\/(run-observability-checkPin|check-ui-standard)\./, /docs\/content-pack\.schema\.json$/];
const OWN_REPO = /^github\.com\/curtismu7\/privilege-bedrock-assume-role-LAB(\/|$)/i;
const isVendored = (p) => VENDORED.some((re) => re.test(p.split(path.sep).join('/')));

test('every host named in this lab\'s own text is loopback, .example or .invalid, or this lab\'s own repo (the apex example.com is not allowed)', () => {
  const bad = [];
  for (const p of mine.filter((f) => !isVendored(f))) {
    for (const m of text(p).matchAll(/\b(?:https?|wss?):\/\/([^\s"'`<>\\)#?]+)/gi)) {
      const h = m[1].replace(/:\d+(?=\/|$)/, '').toLowerCase();
      const host = h.split('/')[0];
      if (!(/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(host) || /(^|\.)(example|invalid)$/.test(host) || host === '${host}' || host.includes('${') || OWN_REPO.test(h))) bad.push(`${path.relative(ROOT, p)}: ${h}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no AI attribution and no key-looking secret in any tracked text', () => {
  for (const p of mine) {
    const t = text(p);
    assert.doesNotMatch(t, ATTRIBUTION, p);
    assert.doesNotMatch(t, /\bsk-(?!MOCK-)[A-Za-z0-9_-]{8,}/, p);
    assert.doesNotMatch(t, /\bAKIA[0-9A-Z]{16}\b/, p);
  }
});

test('IAM examples use placeholder account ids only', () => {
  const allowed = new Set(['111122223333', '444455556666', '999900001111', '555566667777']);
  const bad = [];
  for (const p of mine) for (const m of text(p).matchAll(/::(\d{12})\b/g)) if (!allowed.has(m[1])) bad.push(`${path.relative(ROOT, p)}: ${m[1]}`);
  assert.deepEqual(bad, []);
});

test('policy JSON is data only: no eval, Function constructor, vm, child process or dynamic import in server/src', () => {
  const bad = [];
  const src = files.filter((p) => p.startsWith(path.join(ROOT, 'server', 'src')) && p.endsWith('.js'));
  assert.ok(src.length > 10);
  const patterns = [/\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/, /node:vm|from 'vm'|require\(['"]vm['"]\)/, /child_process/, /\bimport\s*\(/, /\bsetTimeout\s*\(\s*['"`]/];
  for (const p of src) for (const re of patterns) if (re.test(text(p))) bad.push(`${path.relative(ROOT, p)}: ${re}`);
  assert.deepEqual(bad, []);
});

test('the banner says what is simulated and labels the rest UNVERIFIED; the console fields, session length and error texts are listed', () => {
  assert.match(BANNER, /^SIMULATED\./);
  assert.match(BANNER, /2026-11-21 release notes/);
  assert.match(BANNER, /UNVERIFIED/);
  assert.match(BANNER, /console setup fields/);
  assert.match(BANNER, /session length/);
  assert.match(BANNER, /error text/);
  for (const word of [/console setup fields/, /session length/, /error text/, /order of the checks/, /which principal/, /guard step/]) assert.ok(UNVERIFIED.some((u) => word.test(u)), String(word));
});

test('node:test is run with a glob, never a directory', () => {
  const pkg = JSON.parse(text(path.join(ROOT, 'server/package.json')));
  assert.equal(pkg.scripts.test, 'node --test test/*.test.js');
  assert.equal(JSON.parse(text(path.join(ROOT, 'package.json'))).engines.node, '>=26');
});

test('CI workflow, licence and the shared attribution script are present; doctor runs on the provisional port', () => {
  const ci = text(path.join(ROOT, '.github/workflows/ci.yml'));
  for (const job of ['build:', 'test:', 'doctor:', 'forbidden-strings:', 'gitleaks:']) assert.ok(ci.includes(`\n  ${job}`), job);
  assert.match(ci, /PORT=7838 npm run doctor/);
  assert.match(ci, /node-version: 26/);
  assert.match(text(path.join(ROOT, 'LICENSE')), /^MIT License[\s\S]*privilege-bedrock-assume-role-LAB contributors/);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/check-no-ai-attribution.sh')));
});
