#!/usr/bin/env node
// Phase 11 (Voice readiness) verification.
//
// Unlike every SQL verification script in this project, this one runs pure
// JavaScript/TypeScript logic directly, with zero network access and zero
// Supabase/Postgres involved -- because that is exactly what packages/ai/
// src/voice.ts is: TwiML string building, Twilio webhook payload parsing,
// and the Twilio request-signature algorithm, none of which touch a
// database or a live phone call. This is the ONE part of the AI/voice layer
// this sandbox can verify by actually EXECUTING the real source file,
// rather than only checking that it parses (see verify_ts_syntax.mjs).
//
// Method: transpile packages/ai/src/voice.ts with the TypeScript compiler
// already used by verify_ts_syntax.mjs, write the JS to a temp file, and
// import the REAL exported functions -- not a hand-copied reimplementation
// of them, which could silently drift from the actual source.
//
// What Test D (signature verification) does and does NOT prove: it computes
// an HMAC-SHA1 signature with Node's OWN, independent `crypto` module,
// following the same publicly documented Twilio algorithm voice.ts
// implements, and checks the two agree -- i.e. two independent
// implementations of the documented algorithm produce the same answer, and
// a tampered payload/wrong token is correctly rejected. It does NOT prove
// this matches a signature Twilio's real servers would produce for a real
// call, since no live Twilio account or request is available here.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'packages/ai/src/voice.ts');
const tempPath = path.join(root, 'packages/ai/src/.voice_transpiled_for_test.mjs');

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const source = readFileSync(sourcePath, 'utf8');
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, isolatedModules: true },
  reportDiagnostics: true,
  fileName: sourcePath,
});
const syntaxErrors = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
if (syntaxErrors.length > 0) {
  console.error('voice.ts failed to transpile -- aborting.');
  process.exit(1);
}

writeFileSync(tempPath, outputText, 'utf8');

let mod;
try {
  mod = await import(`file://${tempPath}?t=${Date.now()}`);
} finally {
  unlinkSync(tempPath);
}

const { buildSayOnlyTwiml, buildGatherSpeechTwiml, parseTwilioSpeechWebhook, verifyTwilioSignature } = mod;

console.log('=== TEST A: buildSayOnlyTwiml ===');
{
  const xml = buildSayOnlyTwiml('Hello & welcome <there>', 'de');
  check('starts with XML declaration', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  check('uses German TwiML locale', xml.includes('language="de-DE"'));
  check('escapes & and < >', xml.includes('Hello &amp; welcome &lt;there&gt;'));
  check('unknown locale falls back to en-US', buildSayOnlyTwiml('hi', 'xx').includes('language="en-US"'));
}

console.log('=== TEST B: buildGatherSpeechTwiml ===');
{
  const xml = buildGatherSpeechTwiml('What time?', 'https://example.com/next', { locale: 'el', noInputMessage: 'Sorry, no input.' });
  check('contains Gather with action url', xml.includes('<Gather') && xml.includes('action="https://example.com/next"'));
  check('contains speech input mode', xml.includes('input="speech"'));
  check('contains the prompt inside Gather', xml.includes('What time?'));
  check('contains the fallback no-input message', xml.includes('Sorry, no input.'));
  check('uses Greek TwiML locale', xml.includes('language="el-GR"'));
}

console.log('=== TEST C: parseTwilioSpeechWebhook ===');
{
  const parsed = parseTwilioSpeechWebhook({
    CallSid: 'CA123',
    From: '+491701234567',
    To: '+493012345678',
    SpeechResult: 'table for two tonight',
    Confidence: '0.87',
  });
  check('parses CallSid/From/To', parsed.callSid === 'CA123' && parsed.fromPhone === '+491701234567' && parsed.toPhone === '+493012345678');
  check('parses SpeechResult', parsed.speechResult === 'table for two tonight');
  check('parses Confidence as a number', parsed.confidence === 0.87);

  let threw = false;
  try {
    parseTwilioSpeechWebhook({ From: '+491701234567' }); // missing CallSid/To
  } catch {
    threw = true;
  }
  check('throws on missing required fields instead of silently guessing', threw);
}

console.log('=== TEST D: verifyTwilioSignature (cross-checked against an independent HMAC implementation) ===');
{
  const authToken = 'test_auth_token_not_real';
  const url = 'https://example.supabase.co/functions/v1/voice-webhook';
  const params = { CallSid: 'CA123', From: '+491701234567', To: '+493012345678', SpeechResult: 'hello' };

  // Independent reference implementation (Node's own crypto), following the
  // same documented Twilio algorithm: sort params by key, concatenate
  // key+value onto the URL, HMAC-SHA1 with the auth token, base64.
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expectedSignature = createHmac('sha1', authToken).update(data).digest('base64');

  const validResult = await verifyTwilioSignature(authToken, url, params, expectedSignature);
  check('accepts a signature computed by an independent HMAC-SHA1 implementation', validResult === true);

  const wrongToken = await verifyTwilioSignature('a_different_token', url, params, expectedSignature);
  check('rejects when the auth token differs', wrongToken === false);

  const tamperedParams = { ...params, From: '+490000000000' };
  const tamperedResult = await verifyTwilioSignature(authToken, url, tamperedParams, expectedSignature);
  check('rejects when a param is tampered with after signing', tamperedResult === false);

  const noHeader = await verifyTwilioSignature(authToken, url, params, null);
  check('rejects a missing signature header', noHeader === false);
}

console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
