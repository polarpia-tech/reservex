#!/usr/bin/env node
// Phase 17 (Deployment): real checks on the deployment configuration this
// phase added -- not just eyeballing YAML/TOML by hand.
//
// Honesty note, same pattern as every other verify_phaseNN script: there is
// no git remote here to actually push to GitHub and let a real Actions
// runner execute ci.yml/deploy.yml, and no `supabase` CLI network access to
// really `link`/`db push`/`functions deploy` against a live project. What
// this DOES verify, for real:
//   1. Both workflow files parse as valid YAML (via Python's PyYAML, the
//      one real YAML parser available in this sandbox -- Node has none
//      installed and no network to add one). Catches indentation/quoting
//      mistakes that would otherwise only surface as a cryptic "workflow
//      file is invalid" once pushed to a real repo.
//   2. supabase/config.toml parses as valid TOML (Python's stdlib
//      `tomllib`, real parser, not a regex).
//   3. Every Edge Function directory under supabase/functions/ (except the
//      non-deployable `_shared` helper) has a matching `[functions.<name>]`
//      section in supabase/config.toml -- catches the easy mistake of
//      adding a new function later and forgetting to declare it (which
//      silently defaults to `verify_jwt = true`, wrong for a webhook).
//   4. stripe-webhook and voice-webhook specifically have `verify_jwt =
//      false` (see config.toml's own header comment for why this direction
//      matters) -- and no OTHER function does, since defaulting the wrong
//      function to `verify_jwt = false` would be a real, silent
//      authorization gap.
//   5. Every environment variable this codebase actually reads via
//      `Deno.env.get('X')` / `process.env.X` (found by grepping the real
//      source, not a hand-maintained list that can drift) has SOME mention
//      in the root .env.example -- catches the exact class of gap this
//      phase found and fixed (TWILIO_AUTH_TOKEN/ANTHROPIC_MODEL_SMALL/
//      ANTHROPIC_MODEL_LARGE were read by real code but undocumented).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`OK   ${label}`);
  } else {
    console.log(`FAIL ${label}${detail ? ' -- ' + detail : ''}`);
    failures++;
  }
}

function pythonJson(script) {
  const out = execFileSync('python3', ['-c', script], { encoding: 'utf8' });
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// 1. YAML syntax -- both workflow files.
// ---------------------------------------------------------------------------
for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
  const abs = path.join(root, rel);
  try {
    const result = pythonJson(`
import yaml, json
with open(${JSON.stringify(abs)}) as f:
    data = yaml.safe_load(f)
print(json.dumps({"ok": True, "jobKeys": list(data.get("jobs", {}).keys())}))
`);
    check(`${rel} parses as valid YAML`, result.ok === true, `jobs found: ${result.jobKeys.join(', ')}`);
  } catch (err) {
    check(`${rel} parses as valid YAML`, false, String(err.message || err).split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// 2. TOML syntax -- supabase/config.toml.
// ---------------------------------------------------------------------------
const configTomlPath = path.join(root, 'supabase/config.toml');
let tomlData = null;
try {
  tomlData = pythonJson(`
import tomllib, json
with open(${JSON.stringify(configTomlPath)}, 'rb') as f:
    data = tomllib.load(f)
print(json.dumps(data))
`);
  check('supabase/config.toml parses as valid TOML', tomlData !== null);
} catch (err) {
  check('supabase/config.toml parses as valid TOML', false, String(err.message || err).split('\n')[0]);
}

// ---------------------------------------------------------------------------
// 3+4. Every real function directory is declared, and verify_jwt is
// correct for the two external-webhook functions specifically.
// ---------------------------------------------------------------------------
const functionsDir = path.join(root, 'supabase/functions');
const realFunctionNames = readdirSync(functionsDir).filter(
  (name) => name !== '_shared' && statSync(path.join(functionsDir, name)).isDirectory(),
);

if (tomlData) {
  const declared = tomlData.functions ?? {};
  for (const name of realFunctionNames) {
    check(`supabase/config.toml declares [functions.${name}]`, Object.prototype.hasOwnProperty.call(declared, name));
  }

  const expectNoJwt = new Set(['stripe-webhook', 'voice-webhook']);
  for (const name of realFunctionNames) {
    const entry = declared[name] ?? {};
    const verifyJwt = entry.verify_jwt;
    if (expectNoJwt.has(name)) {
      check(`${name} has verify_jwt = false (external webhook, no Supabase session)`, verifyJwt === false);
    } else {
      check(`${name} does NOT set verify_jwt = false (must keep the default Supabase-session check)`, verifyJwt !== false);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Every real env var read by source code is documented in .env.example.
// ---------------------------------------------------------------------------
function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const sourceFiles = [
  ...walk(path.join(root, 'apps'), ['.ts', '.tsx']),
  ...walk(path.join(root, 'packages'), ['.ts', '.tsx']),
  ...walk(path.join(root, 'supabase/functions'), ['.ts']),
];

const envVarPattern = /process\.env\.([A-Z][A-Z0-9_]*)|Deno\.env\.get\(\s*'([A-Z][A-Z0-9_]*)'\s*\)/g;
const foundVars = new Set();
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(envVarPattern)) {
    foundVars.add(m[1] || m[2]);
  }
}

// The root .env.example documents the unprefixed, server-side/Edge
// Function canonical names (SUPABASE_URL, SUPABASE_ANON_KEY); each app's
// OWN .env.example documents the EXPO_PUBLIC_/NEXT_PUBLIC_-prefixed client
// variant it actually reads (see the root file's own header comment for
// this deliberate split) -- so "documented somewhere" has to mean root OR
// any app's .env.example, not root alone.
// walk() above skips dotfiles (it exists to find .ts/.tsx source, not
// .env.example), so app .env.example files are collected explicitly here
// instead of reusing it.
const appsDir = path.join(root, 'apps');
const envExampleFiles = [path.join(root, '.env.example')];
for (const appName of readdirSync(appsDir)) {
  const candidate = path.join(appsDir, appName, '.env.example');
  try {
    if (statSync(candidate).isFile()) envExampleFiles.push(candidate);
  } catch {
    // no .env.example for this app -- fine, not every app needs one.
  }
}
const envExampleText = envExampleFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const missing = [...foundVars].filter((v) => !envExampleText.includes(v)).sort();

check(
  `every env var read by source code (${foundVars.size} found) is mentioned in root or an app's .env.example`,
  missing.length === 0,
  missing.length ? `undocumented: ${missing.join(', ')}` : undefined,
);

console.log('');
if (failures === 0) {
  console.log('OK: deployment configuration (workflows, config.toml, .env.example) verified.');
  process.exit(0);
} else {
  console.log(`FAILED: ${failures} check(s) failed -- see above.`);
  process.exit(1);
}
