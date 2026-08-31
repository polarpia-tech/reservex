// Phase 12: Stripe webhook signature verification. Pure, runtime-agnostic
// (WebCrypto, identical in Deno and modern Node) -- no network, no Stripe
// SDK -- exactly the same shape as packages/ai/src/voice.ts's
// verifyTwilioSignature() from Phase 11, and the same honesty boundary
// applies: scripts/verify_phase12_payments_billing.mjs proves this
// implementation of Stripe's publicly documented algorithm agrees with an
// INDEPENDENT HMAC-SHA256 implementation (Node's own `crypto`) on the same
// input, and correctly rejects a tampered payload, a wrong secret, and a
// stale timestamp. It does NOT prove this matches a signature Stripe's real
// servers would produce for a real webhook delivery -- no live Stripe
// account or webhook exists in this sandbox.
//
// Algorithm (Stripe's own docs): the `Stripe-Signature` header is a
// comma-separated list of key=value pairs -- `t` (unix timestamp) and one
// or more `v1` values (more than one during secret rotation). The signed
// payload is `${t}.${rawRequestBody}`; the expected signature is
// HMAC-SHA256(webhookSecret, signedPayload) as a LOWERCASE HEX string
// (unlike Twilio's base64) -- valid if it matches ANY `v1` value AND the
// timestamp is within `toleranceSeconds` of now (replay protection).

function parseSignatureHeader(header: string): { timestamp: string | null; v1Signatures: string[] } {
  let timestamp: string | null = null;
  const v1Signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't') timestamp = value;
    else if (key === 'v1' && value) v1Signatures.push(value);
  }
  return { timestamp, v1Signatures };
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return bufferToHex(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyStripeSignatureResult {
  valid: boolean;
  reason?: 'missing_header' | 'malformed_header' | 'signature_mismatch' | 'timestamp_out_of_tolerance';
}

/**
 * Verifies a raw Stripe webhook request body against its `Stripe-Signature`
 * header. `rawBody` MUST be the exact, unparsed request body text -- even
 * whitespace-insensitive re-serialization of the JSON would change the
 * signature, which is why every caller of this (stripe-webhook) reads the
 * body as text before doing anything else with it, never `req.json()` first.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = 300,
): Promise<VerifyStripeSignatureResult> {
  if (!signatureHeader) return { valid: false, reason: 'missing_header' };

  const { timestamp, v1Signatures } = parseSignatureHeader(signatureHeader);
  if (!timestamp || v1Signatures.length === 0) return { valid: false, reason: 'malformed_header' };

  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  const matches = v1Signatures.some((sig) => timingSafeEqual(sig, expected));
  if (!matches) return { valid: false, reason: 'signature_mismatch' };

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  return { valid: true };
}
