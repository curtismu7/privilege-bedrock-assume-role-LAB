// AirGuard Airlines is the default story (airlines vertical). The other three packs stay, selectable by config or by the picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTICALS, DEFAULT_VERTICAL, CAST_KEYS, castFor, verticalFrom } from '../src/cast.js';
import { STORIES, buildStories, scanStories } from '../src/stories.js';
import { TALK_SECTIONS, buildTalkTrack } from '../src/talkTrack.js';
import { validateConfig, castForVertical, loadCustomerConfig } from '../src/customer.js';
import { SCENARIOS, runScenarioDetailed } from '../src/scenarios.js';
import { buildDiagram, DIAGRAM_NAMES } from '../src/diagramData.js';
import { buildPack } from '../../scripts/build-content-pack.mjs';
import { startLab } from './helpers.js';

// Brands of the other packs and of the retired airline names. A fresh airline run must carry none of them.
const RETIRED = /Northwind|Fabrikam|Contoso|Harbor|Vellum|Meridian Air|Skyline Air|Meridian Journeys|Tessera Travel/i;
const OTHER_PACK_WORDS = /retail|order-support|orders-assistant|support cases|advisor|care-notes|clinical/i;

test('the default vertical is airlines, and a fresh config shows AirGuard Airlines', () => {
  assert.equal(DEFAULT_VERTICAL, 'airlines');
  assert.equal(VERTICALS.airlines.cast.castBrand, 'AirGuard Airlines');
  const fresh = loadCustomerConfig({ file: '/nonexistent/customer.config.json', env: {} });
  assert.equal(fresh.config.vertical, 'airlines');
  assert.equal(fresh.config.cast.castBrand, 'AirGuard Airlines');
  assert.deepEqual(Object.keys(VERTICALS.airlines.cast).sort(), [...CAST_KEYS].sort());
});

test('GET /api/story with no vertical tells the AirGuard Airlines story, and offers all four packs', async () => {
  const lab = await startLab({ customer: validateConfig({}) });
  try {
    const j = (await lab.get('/api/story')).json;
    assert.equal(j.vertical, 'airlines');
    assert.equal(j.cast.castBrand, 'AirGuard Airlines');
    assert.deepEqual(j.verticals.map((v) => v.id).sort(), ['airlines', 'finance', 'health', 'retail']);
    assert.match(JSON.stringify(j.stories) + JSON.stringify(j.talkTrack), /AirGuard Airlines/);
    assert.match((await lab.get('/api/info')).json.defaultPrompt, /rebooking cases/, 'the default prompt is an airline one');
  } finally { await lab.close(); }
});

test('no old brand or other-pack wording in the airline run: stories, talk track, diagram, content pack, and every scenario result and trace', () => {
  const cast = castFor('airlines');
  const rendered = {
    stories: buildStories(cast), talk: buildTalkTrack(cast), diagram: DIAGRAM_NAMES.map((n) => buildDiagram(cast, n)),
    pack: buildPack(), scenarios: SCENARIOS.map((s) => runScenarioDetailed(s.id)),
  };
  for (const [part, value] of Object.entries(rendered)) {
    const text = JSON.stringify(value);
    assert.doesNotMatch(text, RETIRED, `${part}: a retired or other-pack brand`);
    assert.doesNotMatch(text, OTHER_PACK_WORDS, `${part}: other-pack wording`);
    assert.doesNotMatch(text, /\{\{/, `${part}: an unfilled token`);
  }
  assert.ok(JSON.stringify(rendered.stories).includes('AirGuard Airlines'));
});

test('the airline pack is complete: every token a story or talk-track section uses is defined (an undefined token is named, and fails)', () => {
  const talk = Object.fromEntries(TALK_SECTIONS.map((t) => [`talk-track ${t.id}`, t]));
  assert.deepEqual(scanStories(STORIES, { airlines: VERTICALS.airlines }, talk).missing, []);
  const gap = { airlines: { id: 'airlines', cast: { castBrand: 'AirGuard Airlines' } } };
  assert.match(scanStories([{ id: 'S99', title: '{{castBrand}} {{castTool}}' }], gap).missing.join(), /S99 uses \{\{castTool\}\} which airlines lacks/);
});

test('an unknown or hostile vertical falls back to the airline default and does not crash; a saved retail, health or finance config keeps working', () => {
  for (const id of ['nope', '__proto__', '', undefined, 7, null]) assert.equal(verticalFrom(id), 'airlines');
  assert.equal(castFor('nope').castBrand, 'AirGuard Airlines');
  const bad = validateConfig({ vertical: 'mining' });
  assert.equal(bad.config.vertical, 'airlines');
  assert.ok(bad.warnings.length >= 1);
  for (const id of ['retail', 'health', 'finance']) {
    const saved = validateConfig({ vertical: id });
    assert.deepEqual(saved.warnings, []);
    assert.equal(saved.config.vertical, id);
    assert.equal(saved.config.cast.castBrand, VERTICALS[id].cast.castBrand);
    assert.notEqual(saved.config.cast.castBrand, 'AirGuard Airlines');
    assert.equal(castForVertical(validateConfig({}), id).cast.castBrand, VERTICALS[id].cast.castBrand);
    const filled = JSON.stringify([buildStories(saved.config.cast), buildTalkTrack(saved.config.cast)]);
    assert.ok(filled.includes(VERTICALS[id].cast.castBrand), id);
    assert.ok(!filled.includes('AirGuard'), `${id} pack carries no airline brand`);
  }
});
