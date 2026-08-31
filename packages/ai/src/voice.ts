// Phase 11: voice readiness. Everything in this file is a pure, runtime-
// agnostic building block (string templating + WebCrypto, both identical in
// Deno and modern Node) with NO network calls and NO Twilio SDK dependency
// -- exactly the kind of thing that CAN be genuinely unit-tested in this
// sandbox (see scripts/verify_phase11_voice_readiness.mjs), unlike the
// actual live phone call flow, which cannot.
//
// HONESTY NOTE on verifyTwilioSignature(): the algorithm below follows
// Twilio's publicly documented request-validation scheme (HMAC-SHA1 of the
// webhook URL concatenated with each POST param's key+value, sorted by key,
// keyed by the account Auth Token, base64-encoded, compared to the
// X-Twilio-Signature header). What the verification script in this
// repository proves is INTERNAL self-consistency: a signature this same
// function generates validates correctly, and a tampered payload or wrong
// token is correctly rejected. It does NOT prove byte-for-byte conformance
// against a real request Twilio's servers actually signed -- that requires
// a real Twilio account and a real webhook call, neither available here.

const TWIML_LOCALE_MAP: Record<string, string> = {
  de: 'de-DE',
  en: 'en-US',
  el: 'el-GR',
  tr: 'tr-TR',
};

function twilioLocale(locale?: string): string {
  return TWIML_LOCALE_MAP[locale ?? 'en'] ?? TWIML_LOCALE_MAP.en;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A <Say>-only TwiML response -- speaks one message, then Twilio's default
 * behavior (hang up) applies. This is what voice-webhook actually returns
 * today: a short, honest "phone booking isn't available yet" message. See
 * that function's own header comment for why it deliberately does not
 * attempt an AI conversation over the phone in this phase.
 */
export function buildSayOnlyTwiml(message: string, locale?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${twilioLocale(locale)}">${escapeXml(message)}</Say></Response>`;
}

/**
 * <Gather input="speech"> wrapping a <Say> prompt, with a fallback <Say> if
 * no speech is detected before the timeout (TwiML falls through to the next
 * verb after </Gather> in that case). This is the shape a real voice AI
 * turn would use -- NOT wired to anything yet (see this file's header
 * comment) -- provided now so the exact XML is reviewable/testable ahead of
 * actually using it in a future phase.
 */
export function buildGatherSpeechTwiml(
  promptMessage: string,
  actionUrl: string,
  options: { locale?: string; noInputMessage: string },
): string {
  const lang = twilioLocale(options.locale);
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Gather input="speech" language="${lang}" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto">` +
    `<Say language="${lang}">${escapeXml(promptMessage)}</Say>` +
    `</Gather>` +
    `<Say language="${lang}">${escapeXml(options.noInputMessage)}</Say>` +
    `</Response>`
  );
}

export interface TwilioSpeechWebhookPayload {
  callSid: string;
  fromPhone: string;
  toPhone: string;
  speechResult?: string;
  confidence?: number;
}

/** Pure parsing of Twilio's inbound webhook form fields (CallSid/From/To/SpeechResult/Confidence) into our own shape. Throws on a payload missing the fields every Twilio voice webhook always includes -- a real signal something is wrong (wrong endpoint hit, malformed request), not a case to silently tolerate. */
export function parseTwilioSpeechWebhook(formParams: Record<string, string>): TwilioSpeechWebhookPayload {
  const callSid = formParams.CallSid;
  const fromPhone = formParams.From;
  const toPhone = formParams.To;
  if (!callSid || !fromPhone || !toPhone) {
    throw new Error('Missing required Twilio webhook fields (CallSid/From/To).');
  }
  const confidenceRaw = formParams.Confidence;
  return {
    callSid,
    fromPhone,
    toPhone,
    speechResult: formParams.SpeechResult || undefined,
    confidence: confidenceRaw ? Number(confidenceRaw) : undefined,
  };
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa is a global in Deno and in Node 18+; no Buffer import needed, so
  // this file stays dependency-free and importable from either runtime.
  return btoa(binary);
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return bufferToBase64(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Twilio's documented webhook signature scheme: HMAC-SHA1(authToken, url +
 * sorted-concatenated "key"+"value" pairs of every POST param), base64,
 * compared to the X-Twilio-Signature header. See this file's header comment
 * for exactly what has and hasn't been verified about this implementation.
 */
export async function verifyTwilioSignature(
  authToken: string,
  fullUrl: string,
  params: Record<string, string>,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  let data = fullUrl;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  const expected = await hmacSha1Base64(authToken, data);
  return timingSafeEqual(expected, signatureHeader);
}
