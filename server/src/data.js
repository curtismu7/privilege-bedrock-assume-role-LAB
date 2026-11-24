// Text and placeholder identifiers the page and the API show. The banner is the one honesty text: what is simulated, and that
// everything beyond the 2026-11-21 release notes is UNVERIFIED (this lab's own model).
// Every identifier below is a PLACEHOLDER: account ids are made-up digit runs, names start with "example", hosts end in .example.
export const LAB_ID = 'privilege-bedrock-assume-role-lab';
export const LAB_NAME = 'Privilege Bedrock assume-role LAB';
export const RELEASE_NOTES_DATE = '2026-11-21';

export const BANNER = `SIMULATED. This lab runs a mock gateway, a mock IAM evaluator, a mock Bedrock and a mock Vertex AI, and a lab clock; nothing leaves this machine and no AWS or Google call is made. `
  + `Only this is taken from the ${RELEASE_NOTES_DATE} release notes: an LLM key can reach Bedrock under an assumed IAM role, with no provider credential stored on the key and with metering, AI Guard and audit intact, and the same key also works as a fallback target; Vertex service accounts are the sibling feature in the same release. `
  + `Everything else is this lab's own model and is UNVERIFIED against the product: the console setup fields, the session length, every error text, the order of the checks, the name of the principal the gateway presents, and how much of IAM is evaluated (the lab reads a small subset of trust and permission policies).`;

export const UNVERIFIED = Object.freeze([
  'the console setup fields for the role (role, external ID and the rest) and for the Vertex service account',
  'the session length (the lab uses 3600000 ms) and whether the gateway refreshes an expired session by itself',
  'every error text and fix text shown here (they are the lab\'s own wording, not the product\'s or the cloud\'s)',
  'the order of the checks (the lab checks trust, session, invoke permission, then model access in the region)',
  'which principal the gateway presents when it assumes the role (the lab uses a placeholder gateway role)',
  'which IAM action the gateway needs (the lab checks bedrock:InvokeModel) and which Vertex permission it needs (the lab checks aiplatform.endpoints.predict)',
  'how much of IAM is evaluated: the lab reads Allow and Deny statements, wildcard principals, and one condition (sts:ExternalId equals); identity-side permissions, SCPs and permission boundaries are not modelled',
  'the guard step (a labelled stub: it blocks one marker string and says nothing about any product\'s detection)',
  'whether a refused call is still audited and where the audit entry is written',
  'the Vertex role model (the lab grants predict to two roles and to no others)',
  'token counting (the lab charges input words plus a fixed 120-token reply)',
]);

export const REAL_UNAVAILABLE = 'Real mode is not built yet. It needs a tenant running the 2026-11-21 release and an AWS account the owner controls; it is owner-run and read-only, and it comes after Mock.';

// Placeholder identities and policies the lab starts with.
export const GATEWAY_PRINCIPAL = 'arn:aws:iam::444455556666:role/example-gateway-principal';
export const OTHER_PRINCIPAL = 'arn:aws:iam::999900001111:role/example-some-other-caller';
export const ROLE_ARN = 'arn:aws:iam::111122223333:role/example-bedrock-invoke-role';
export const EXTERNAL_ID = 'example-external-id-0001';
export const LARGE_MODEL = 'example.chat-large-v1:0';
export const SMALL_MODEL = 'example.chat-small-v1:0';
export const DEFAULT_REGION = 'us-east-1';
export const SESSION_MS = 3_600_000;

// The lab's account "model access" table: which regions each placeholder model is enabled in.
export const MODEL_CATALOG = Object.freeze({
  [LARGE_MODEL]: Object.freeze(['us-east-1', 'eu-west-1']),
  [SMALL_MODEL]: Object.freeze(['us-east-1', 'eu-west-1', 'ap-southeast-2']),
});

export const VERTEX_SERVICE_ACCOUNT = 'gateway-vertex@example-project-0001.iam.example';
export const VERTEX_OTHER_ACCOUNT = 'someone-else@example-project-0001.iam.example';
export const VERTEX_PROJECT = 'example-project-0001.example';

export const DEFAULT_PROMPT = 'Summarise the open support cases for this week.';
export const GUARD_BLOCK_MARKER = '[[guard-block]]';

const clone = (o) => JSON.parse(JSON.stringify(o));
export const trustPolicy = ({ principal = GATEWAY_PRINCIPAL, externalId = EXTERNAL_ID, effect = 'Allow' } = {}) => ({
  Version: '2012-10-17',
  Statement: [{
    Sid: 'AllowGatewayToAssume', Effect: effect, Principal: { AWS: principal }, Action: 'sts:AssumeRole',
    ...(externalId === null ? {} : { Condition: { StringEquals: { 'sts:ExternalId': externalId } } }),
  }],
});
export const permissionPolicy = ({ action = 'bedrock:InvokeModel', resource = 'arn:aws:bedrock:*::foundation-model/example.chat-*' } = {}) => ({
  Version: '2012-10-17',
  Statement: [{ Sid: 'AllowInvoke', Effect: 'Allow', Action: action, Resource: resource }],
});
export const DEFAULT_AWS = () => clone({ trust: trustPolicy(), permission: permissionPolicy() });

// The Limits page: exactly what the release notes say, what is this lab's own model, and what is not claimed. The one place these are written.
export const SOURCED = Object.freeze([
  `An LLM key can reach Bedrock under an assumed IAM role (${RELEASE_NOTES_DATE} release notes).`,
  'No provider credential is stored on the key.',
  'Metering, AI Guard and audit stay intact on the call.',
  'The same route also works as a fallback target.',
  'Vertex service accounts are the sibling feature in the same release bullet.',
]);

export const LAB_MODEL = Object.freeze([
  'An assumed-role key names a role and an optional external ID and holds no credential field of any kind; a stored-credential key holds a write-only MOCK- placeholder that is never returned or logged.',
  'A call always lists six hops: key, ai-guard, provider-auth, bedrock-invoke, metering, audit. Each is done, failed or skipped, so a failure shows where the call stopped. The guard runs before the role is assumed.',
  'The evaluator reads a trust policy (an Allow must name the caller, a Deny wins, an optional sts:ExternalId equals condition, compared exactly), then the session, then the permission policy (bedrock:InvokeModel on the model\'s ARN), then the lab\'s model-access table for the region.',
  'A new session lasts 3600000 ms on the lab clock. A held session is reused until the clock reaches its expiry exactly; the trust policy is not consulted while it is valid. An expired session is refreshed by assuming the role again.',
  'Policy JSON is data only: at most 10000 characters, depth 8, 600 values and 20 statements; anything the lab does not read is refused as unsupported, never ignored.',
  'Every call, served or refused, writes an audit entry (ids, outcome, lab time; never the prompt, an external ID or a credential).',
  'The Vertex tab models the gateway\'s own service account: it needs a binding to a role that grants aiplatform.endpoints.predict (the lab grants it to roles/aiplatform.user and roles/aiplatform.admin only).',
  'Tokens are counted as input words plus a fixed 120-token reply; the key has its own budget.',
]);

export const NOT_CLAIMED = Object.freeze([
  'Whether a gateway\'s own rate-limit refusal can trigger a fallback. This is an open question and the lab shows no opinion on it (owner decision 2026-11-24).',
  'Identity-side permissions, service control policies and permission boundaries are not modelled.',
]);

// Copy-paste IAM examples. PLACEHOLDER ids only: made-up account ids, names starting "example", the placeholder external ID. Never paste a real one.
export const IAM_SNIPPETS = Object.freeze([
  { id: 'trust', title: 'Trust policy (who may assume the role)', language: 'json', text: JSON.stringify(trustPolicy(), null, 2) },
  { id: 'permission', title: 'Permission policy (what the role may do)', language: 'json', text: JSON.stringify(permissionPolicy(), null, 2) },
  {
    id: 'cli', title: 'Create the role (placeholder names; run in an account you control)', language: 'sh',
    text: [
      'aws iam create-role --role-name example-bedrock-invoke-role \\',
      '  --assume-role-policy-document file://trust-policy.json',
      'aws iam put-role-policy --role-name example-bedrock-invoke-role \\',
      '  --policy-name example-bedrock-invoke --policy-document file://permission-policy.json',
    ].join('\n'),
  },
  {
    id: 'vertex', title: 'Vertex AI binding (the gateway\'s own service account)', language: 'json',
    text: JSON.stringify({ bindings: [{ role: 'roles/aiplatform.user', members: [`serviceAccount:${VERTEX_SERVICE_ACCOUNT}`] }] }, null, 2),
  },
]);
