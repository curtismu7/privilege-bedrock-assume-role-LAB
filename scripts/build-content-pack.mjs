// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERTICALS, DEFAULT_VERTICAL, fillDeep } from '../server/src/cast.js';
import { STORIES } from '../server/src/stories.js';
import { SCENARIOS } from '../server/src/scenarios.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const cast = VERTICALS[DEFAULT_VERTICAL].cast;
  const stories = STORIES.map(({ file, ...s }) => ({ file, ...fillDeep(s, cast) }));
  const terms = {
    success: ['assumed-role-key'], 'wrong-trust-principal': ['trust-policy', 'named-result'], 'external-id-mismatch': ['external-id', 'named-result'], 'external-id-missing': ['external-id', 'named-result'],
    'missing-invoke-permission': ['permission-policy', 'named-result'], 'model-not-enabled-in-region': ['named-result'], 'expired-session-refreshed': ['assumed-role-key', 'unverified-model'],
    'guard-still-applies': ['assumed-role-key'], 'stored-vs-assumed-key-shape': ['assumed-role-key'], 'assumed-role-as-fallback-target': ['assumed-role-key'],
    'vertex-with-role': ['vertex-service-account'], 'vertex-without-role': ['vertex-service-account', 'named-result'], 'vertex-role-insufficient': ['vertex-service-account', 'named-result'],
  };
  const page = (scenario) => (SCENARIOS.find((x) => x.id === scenario)?.kind === 'vertex' ? 'vertex' : 'assumed-role');
  return {
    schema: 'demo-content-pack/1',
    id: 'privilege-bedrock-assume-role-lab',
    title: 'Privilege Bedrock assume-role LAB',
    version,
    demo: { id: 'privilege-bedrock-assume-role-lab', name: 'Privilege Bedrock assume-role LAB', catalog: 'D000', baseUrl: 'http://localhost:7838', doctor: '/api/health', tags: ['llm', 'bedrock', 'assume-role', 'vertex', 'privilege', 'simulated', 'mock-only'] },
    glossary: [
      { id: 'assumed-role-key', term: 'Assumed-role key', definition: 'An LLM key that reaches Bedrock under an assumed IAM role and stores no provider credential. Metering, AI Guard and audit stay intact on the call, and the same route also works as a fallback target. These are the claims taken from the 2026-11-21 release notes; everything about how the lab shows them is its own model.', aliases: ['assume role', 'no stored credential'] },
      { id: 'trust-policy', term: 'Trust policy', definition: 'The policy on the role that says who may assume it. In the lab an Allow must name the principal the gateway presents, a Deny wins, and an optional external-ID condition is compared exactly. The lab reads a small subset of IAM as data and never evaluates policy text as code.', aliases: ['role trust'] },
      { id: 'permission-policy', term: 'Permission policy', definition: 'The policy on the role that says what it may do once assumed. The lab checks one action, bedrock:InvokeModel, on the model\'s ARN. Identity-side permissions, service control policies and permission boundaries are not modelled.', aliases: ['invoke permission'] },
      { id: 'external-id', term: 'External ID', definition: 'A value the trust policy can require and the key must carry. The lab compares it exactly and case-sensitively; an empty one counts as none. Missing and mismatched are two different named results with different fixes.', aliases: ['sts:ExternalId'] },
      { id: 'named-result', term: 'Named result', definition: 'Every way the role assumption or the invoke can fail has its own code, title and fix: wrong trust principal, external ID missing or mismatched, missing invoke permission, model not enabled in the region, expired session. The wording is the lab\'s own and UNVERIFIED.', aliases: ['fix'] },
      { id: 'vertex-service-account', term: 'Vertex service account', definition: 'On Vertex AI the gateway uses its own service account: no role is assumed, there is no external ID and no session. The lab needs a binding to a role that grants aiplatform.endpoints.predict (roles/aiplatform.user or roles/aiplatform.admin). The role model is the lab\'s own and UNVERIFIED.', aliases: ['vertex'] },
      { id: 'unverified-model', term: 'UNVERIFIED (lab model)', definition: 'Anything the release notes do not say is the lab\'s own model and is labelled UNVERIFIED: the console setup fields, the session length, every error text, the order of the checks, the principal the gateway presents, and whether an expired session refreshes by itself.', aliases: ['lab model'] },
    ],
    sources: [],
    cards: [
      ...stories.map((s) => ({ id: `try-${s.scenario}`, label: `${s.id}: ${s.title}`, description: s.control, group: 'try-it', action: { type: 'route', href: `/#${page(s.scenario)}/${s.scenario}` }, terms: terms[s.scenario], story: s.id })),
      { id: 'concept-limits', label: 'What is sourced and what is the lab\'s model', description: 'The release-notes claims, the lab\'s own model and the list of what is UNVERIFIED.', group: 'concept', action: { type: 'route', href: '/#limits' }, terms: ['unverified-model'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    diagrams: [{ id: 'bedrock-assumed-role', label: 'Bedrock under an assumed role: no stored credential', href: '/#diagram', mode: 'mock' }],
    stories: stories.map((s) => ({ id: s.id, title: s.title, say: s.control, file: `server/src/data/stories/${s.file}` })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
