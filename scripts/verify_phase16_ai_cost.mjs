#!/usr/bin/env node
// Phase 16 (AI cost): real execution checks for the two code changes this
// phase made, not just eyeballing the source.
//
// Honesty note, same as every other verify_phaseNN script in this project:
// there is no network access in this sandbox to actually call
// api.anthropic.com, and ai-gateway/index.ts is a Deno Edge Function this
// sandbox has no Deno runtime to execute. What this script DOES prove, by
// really transpiling and running code (via ts.transpileModule, same
// technique verify_phase14_web_pwa.mjs uses for app/manifest.ts):
//   1. AnthropicProvider.chat() -- transpiled and actually invoked, with
//      global.fetch replaced by a stub that captures the real outgoing
//      request body instead of hitting the network -- genuinely sends
//      `system` as an array-of-content-blocks with cache_control on it,
//      and cache_control on (only) the LAST tool definition. Catches a
//      real class of mistake this technique is good at: e.g. forgetting
//      the array wrapper, or marking every tool instead of just the last
//      one.
//   2. loadHistory() in ai-gateway/index.ts -- Deno-only imports mean it
//      can't be transpiled/run directly here, so this is a structural
//      source check (MAX_HISTORY_MESSAGES is defined and used, the query
//      is ordered descending with a .limit(), and the result is reversed
//      before being returned) -- weaker evidence than genuine execution,
//      disclosed as such rather than dressed up as more than it is.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

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

// ---------------------------------------------------------------------------
// 1. AnthropicProvider.chat() -- transpile + actually execute.
// ---------------------------------------------------------------------------
const providerSrcPath = path.join(root, 'packages/ai/src/providers/anthropic.ts');
const providerSrc = readFileSync(providerSrcPath, 'utf8');

// provider.ts (VoiceNotImplementedError) is a sibling import -- transpile
// it too and rewrite the relative import to point at the transpiled copy,
// same approach verify_phase14_web_pwa.mjs uses for manifest.ts's imports.
const voiceSrcPath = path.join(root, 'packages/ai/src/provider.ts');
const voiceSrc = readFileSync(voiceSrcPath, 'utf8');

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'reservex-verify16-'));

const voiceJs = ts.transpileModule(voiceSrc, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText;
writeFileSync(path.join(tmpDir, 'provider.mjs'), voiceJs);

const providerJs = ts
  .transpileModule(providerSrc, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  })
  .outputText.replace("from '../provider'", "from './provider.mjs'")
  .replace("from '../types'", "from './types.mjs'"); // types.ts has no runtime exports, stub it below
writeFileSync(path.join(tmpDir, 'anthropic.mjs'), providerJs);
writeFileSync(path.join(tmpDir, 'types.mjs'), '// type-only, no runtime exports\n');

const { AnthropicProvider } = await import(pathToFileURL(path.join(tmpDir, 'anthropic.mjs')).href);

let capturedBody = null;
const originalFetch = global.fetch;
global.fetch = async (_url, init) => {
  capturedBody = JSON.parse(init.body);
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-haiku-4-5-mock' }),
  };
};

try {
  const provider = new AnthropicProvider({ apiKey: 'test-key-not-real' });
  await provider.chat({
    systemPrompt: 'You are the ReservX AI Gateway.',
    messages: [{ role: 'user', content: 'Book a table for 2 tonight.' }],
    tools: [
      { name: 'findAvailability', description: 'x', inputSchema: { type: 'object', properties: {} } },
      { name: 'createReservation', description: 'y', inputSchema: { type: 'object', properties: {} } },
    ],
    preferredModel: 'small',
  });
} finally {
  global.fetch = originalFetch;
}

check('AnthropicProvider.chat() actually called fetch (request body captured)', capturedBody !== null);

if (capturedBody) {
  const systemIsArray = Array.isArray(capturedBody.system);
  check('system is sent as an array of content blocks (required for cache_control)', systemIsArray);
  if (systemIsArray) {
    check(
      'system[0] carries cache_control: {type: "ephemeral"}',
      capturedBody.system[0]?.cache_control?.type === 'ephemeral',
    );
    check('system[0].text still contains the real system prompt', capturedBody.system[0]?.text === 'You are the ReservX AI Gateway.');
  }

  const toolsArr = capturedBody.tools ?? [];
  check('tools array has both tool definitions (2)', toolsArr.length === 2);
  check(
    'only the LAST tool definition carries cache_control (not the first)',
    toolsArr[0]?.cache_control === undefined && toolsArr[1]?.cache_control?.type === 'ephemeral',
  );
  check('messages array carries NO cache_control (it changes every turn, caching it would never hit)', !JSON.stringify(capturedBody.messages ?? []).includes('cache_control'));
}

// ---------------------------------------------------------------------------
// 2. loadHistory() in ai-gateway/index.ts -- structural source check
// (cannot execute: Deno-only imports, see header comment).
// ---------------------------------------------------------------------------
const gatewaySrc = readFileSync(path.join(root, 'supabase/functions/ai-gateway/index.ts'), 'utf8');

check('MAX_HISTORY_MESSAGES constant is defined', /const MAX_HISTORY_MESSAGES\s*=\s*\d+/.test(gatewaySrc));

const loadHistoryMatch = gatewaySrc.match(/async function loadHistory[\s\S]*?\n}/);
check('loadHistory() function found in source', Boolean(loadHistoryMatch));
if (loadHistoryMatch) {
  const body = loadHistoryMatch[0];
  check('loadHistory() orders by created_at DESCENDING (required so .limit() keeps the MOST RECENT messages)', /ascending:\s*false/.test(body));
  check('loadHistory() applies .limit(MAX_HISTORY_MESSAGES)', /\.limit\(MAX_HISTORY_MESSAGES\)/.test(body));
  check('loadHistory() reverses the result back to chronological order before returning', /\.reverse\(\)/.test(body));
}

console.log('');
if (failures === 0) {
  console.log('OK: AnthropicProvider prompt-caching request shape and ai-gateway history cap both verified.');
  process.exit(0);
} else {
  console.log(`FAILED: ${failures} check(s) failed -- see above.`);
  process.exit(1);
}
