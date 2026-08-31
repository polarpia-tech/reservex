#!/usr/bin/env node
// Phase 12 (Payments & billing) verification, part 2 of 2 -- see
// scripts/verify_phase12_payments_billing.sql for the database-side proof
// (compute_deposit_amount, evaluate_reservation_cancellation_refund, RLS).
//
// This script proves packages/payments/src/stripeSignature.ts the same way
// scripts/verify_phase11_voice_readiness.mjs proves voice.ts: transpile the
// REAL source with the TypeScript compiler and execute the actual exported
// function, rather than a hand-copied reimplementation that could silently
// drift from the source. verifyStripeSignature is pure (WebCrypto only, no
// network, no Deno/Supabase involved), so it is the one part of the Stripe
// integration this sandbox can verify by actually RUNNING it.
//
// What this does NOT prove: that this matches a signature Stripe's real
// servers would produce for a real webhook delivery -- no live Stripe
// account or webhook exists in this sandbox. What it DOES prove: an
// independent HMAC-SHA256 implementation (Node's own `crypto`, not
// stripeSignature.ts's WebCrypto call) agrees with the real source on the
// same input, and the function correctly rejects a tampered body, a wrong
// secret, a stale timestamp, a missing header, and a malformed header.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'packages/payments/src/stripeSignature.ts');
const tempPath = path.join(root, 'packages/payments/src/.stripeSignature_transpiled_for_test.mjs');

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
  console.error('stripeSignature.ts failed to transpile -- aborting.');
  console.error(syntaxErrors.map((d) => d.messageText).join('\n'));
  process.exit(1);
}

writeFileSync(tempPath, outputText, 'utf8');

let mod;
try {
  mod = await import(`file://${tempPath}?t=${Date.now()}`);
} finally {
  unlinkSync(tempPath);
}

const { verifyStripeSignature } = mod;

// Node's global `crypto` (WebCrypto) is what the real source uses via
// `crypto.subtle` -- available in Node 20+ without any import, exactly as
// it would be in the Deno Edge Function runtime. No polyfill needed here.

function buildHeader(secret, rawBody, { timestamp = Math.floor(Date.now() / 1000), extraSignatures = [] } = {}) {
  // Independent reference implementation -- Node's own `createHmac`, NOT
  // the WebCrypto call inside stripeSignature.ts -- following the same
  // publicly documented Stripe algorithm: HMAC-SHA256(secret, `${t}.${body}`),
  // lowercase hex.
  const signedPayload = `${timestamp}.${rawBody}`;
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const v1Values = [signature, ...extraSignatures];
  return { header: `t=${timestamp},` + v1Values.map((v) => `v1=${v}`).join(','), signature, timestamp };
}

console.log('=== TEST A: a signature computed by an independent HMAC-SHA256 implementation is accepted ===');
{
  const secret = 'whsec_test_not_a_real_secret';
  const rawBody = JSON.stringify({ id: 'evt_test_123', type: 'payment_intent.succeeded', data: { object: { id: 'pi_test_123' } } });
  const { header } = buildHeader(secret, rawBody);

  const result = await verifyStripeSignature(rawBody, header, secret);
  check('accepts a valid signature', result.valid === true);
  check('no reason set on success', result.reason === undefined);
}

console.log('=== TEST B: tampering after signing is rejected ===');
{
  const secret = 'whsec_test_not_a_real_secret';
  const rawBody = JSON.stringify({ id: 'evt_test_123', amount: 2000 });
  const { header } = buildHeader(secret, rawBody);

  const tamperedBody = JSON.stringify({ id: 'evt_test_123', amount: 999999 }); // guest's card was NOT actually charged this
  const result = await verifyStripeSignature(tamperedBody, header, secret);
  check('rejects a body that differs from what was signed', result.valid === false && result.reason === 'signature_mismatch');
}

console.log('=== TEST C: the wrong webhook secret is rejected ===');
{
  const rawBody = JSON.stringify({ id: 'evt_test_456' });
  const { header } = buildHeader('whsec_the_real_one', rawBody);

  const result = await verifyStripeSignature(rawBody, header, 'whsec_a_different_one');
  check('rejects when verified against a different secret than it was signed with', result.valid === false && result.reason === 'signature_mismatch');
}

console.log('=== TEST D: a stale timestamp is rejected (replay protection) ===');
{
  const secret = 'whsec_test_not_a_real_secret';
  const rawBody = JSON.stringify({ id: 'evt_test_stale' });
  const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
  const { header } = buildHeader(secret, rawBody, { timestamp: staleTimestamp });

  const result = await verifyStripeSignature(rawBody, header, secret, 300); // 5-minute tolerance
  check('rejects a signature whose timestamp is older than the tolerance window', result.valid === false && result.reason === 'timestamp_out_of_tolerance');

  const freshResult = await verifyStripeSignature(rawBody, header, secret, 7200); // 2-hour tolerance -- same header, now accepted
  check('the SAME header is accepted once the caller widens the tolerance window past its age', freshResult.valid === true);
}

console.log('=== TEST E: a missing or malformed Stripe-Signature header is rejected, not silently ignored ===');
{
  const secret = 'whsec_test_not_a_real_secret';
  const rawBody = JSON.stringify({ id: 'evt_test_789' });

  const missing = await verifyStripeSignature(rawBody, null, secret);
  check('rejects a null header', missing.valid === false && missing.reason === 'missing_header');

  const malformed = await verifyStripeSignature(rawBody, 't=not_a_number_and_no_v1_value', secret);
  check('rejects a header with no v1 signature', malformed.valid === false && malformed.reason === 'malformed_header');
}

console.log('=== TEST F: secret rotation -- multiple v1 values in one header, any match accepts ===');
{
  const secret = 'whsec_current_secret';
  const rawBody = JSON.stringify({ id: 'evt_test_rotation' });
  const timestamp = Math.floor(Date.now() / 1000);
  const currentSig = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const oldSig = createHmac('sha256', 'whsec_old_secret_being_retired').update(`${timestamp}.${rawBody}`).digest('hex');
  // Stripe sends both during a secret rotation window -- order in the header is not significant.
  const header = `t=${timestamp},v1=${oldSig},v1=${currentSig}`;

  const result = await verifyStripeSignature(rawBody, header, secret);
  check('accepts when ANY v1 value in the header matches (not just the first)', result.valid === true);
}

console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
