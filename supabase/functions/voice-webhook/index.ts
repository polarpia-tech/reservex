// deno-lint-ignore-file no-explicit-any
import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { buildSayOnlyTwiml, parseTwilioSpeechWebhook, verifyTwilioSignature } from '../../../packages/ai/src/voice.ts';

/**
 * voice-webhook
 * =============
 * Phase 11: the call-answering SKELETON a future Twilio Voice number would
 * point at -- signature verification, tenant resolution, and an honest
 * audit-logged non-answer. It deliberately does NOT attempt an AI
 * conversation over the phone.
 *
 * Why stop here (see the blueprint, Part 05, "why we are not building the
 * phone AI receptionist now"): a caller talking to an AI has zero error
 * tolerance -- a missed or wrong booking loses the restaurant a guest and
 * loses the owner's trust in this whole product. Voice tech (latency,
 * accuracy in a noisy room, accented speech) is not yet reliable enough for
 * an irreversible action taken with no human confirmation step, which is
 * exactly what a live phone call is (there is no "show me a confirm card"
 * over a phone line the way ai.tsx does in the app). This function exists
 * so a restaurant COULD point a number at it today, safely -- it always
 * responds with a short, honest message and change nothing -- while the
 * actual tool-calling conversation loop (reusing the same AI_TOOLS /
 * TOOL_EXECUTORS as ai-gateway, scoped down to whatever a fully anonymous
 * caller should be allowed to do) is a deliberately separate, later
 * decision.
 *
 * Known limitation, worth stating rather than silently working around: this
 * does not correlate multiple turns of the SAME call into one
 * ai_conversations row (there is no call_sid column anywhere yet) --
 * because there is only ever one turn today (a single Say, then hang up).
 * A future phase that adds real <Gather>-based back-and-forth will need
 * that correlation and should add it then, not before it's needed.
 *
 * HONESTY NOTE: like ai-gateway, this has not been deployed or exercised
 * against a live Supabase project, and CANNOT be exercised against a real
 * Twilio call in this sandbox (no Twilio account, no phone number, no
 * network access to Twilio at all). What IS verified here, in
 * scripts/verify_phase11_voice_readiness.mjs, is every pure function this
 * file calls: TwiML building, webhook parsing, and the signature
 * verification's internal self-consistency (see packages/ai/src/voice.ts's
 * header comment for exactly what that does and does not prove).
 */

const FALLBACK_MESSAGE: Record<string, string> = {
  de: 'Vielen Dank für Ihren Anruf. Die telefonische Reservierung per KI ist noch nicht verfügbar. Bitte rufen Sie später erneut an oder nutzen Sie unsere Webseite.',
  en: 'Thank you for calling. Phone booking with our assistant is not available yet. Please try our website, or call back later.',
  el: 'Ευχαριστούμε για την κλήση. Η τηλεφωνική κράτηση μέσω βοηθού δεν είναι ακόμα διαθέσιμη. Δοκιμάστε την ιστοσελίδα μας ή καλέστε ξανά αργότερα.',
  tr: 'Aradığınız için teşekkürler. Telefonla yapay zeka ile rezervasyon henüz kullanılamıyor. Lütfen web sitemizi deneyin ya da daha sonra tekrar arayın.',
};

const UNKNOWN_NUMBER_MESSAGE = 'Sorry, this number is not yet configured for phone booking.';

function xmlResponse(twiml: string, status = 200): Response {
  return new Response(twiml, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!authToken) {
    console.error('voice-webhook: TWILIO_AUTH_TOKEN is not configured -- refusing to process any call unverified.');
    return new Response('Not configured.', { status: 500 });
  }

  const rawForm = await req.formData().catch(() => null);
  if (!rawForm) return new Response('Bad request.', { status: 400 });

  const params: Record<string, string> = {};
  for (const [key, value] of rawForm.entries()) {
    if (typeof value === 'string') params[key] = value;
  }

  // Signature covers the exact URL Twilio was configured to call -- fail
  // closed on anything that doesn't check out, same principle as every
  // other authorization check in this codebase.
  const signatureHeader = req.headers.get('X-Twilio-Signature');
  const isValidSignature = await verifyTwilioSignature(authToken, req.url, params, signatureHeader);
  if (!isValidSignature) {
    console.error('voice-webhook: invalid X-Twilio-Signature -- rejecting.');
    return new Response('Forbidden.', { status: 403 });
  }

  let payload;
  try {
    payload = parseTwilioSpeechWebhook(params);
  } catch (err) {
    console.error('voice-webhook: malformed Twilio payload', err);
    return new Response('Bad request.', { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: restaurant } = await adminClient
    .from('restaurants')
    .select('id, default_locale')
    .eq('ai_voice_phone_number', payload.toPhone)
    .maybeSingle();

  if (!restaurant) {
    // No tenant recognizes this number -- log nothing (there is no
    // restaurant_id to attach an ai_conversations row to) and respond
    // safely rather than erroring the call.
    return xmlResponse(buildSayOnlyTwiml(UNKNOWN_NUMBER_MESSAGE, 'en'));
  }

  const locale = (restaurant as any).default_locale ?? 'en';
  const message = FALLBACK_MESSAGE[locale] ?? FALLBACK_MESSAGE.en;

  // find_customer_by_phone is SECURITY DEFINER with no client grants (0018)
  // -- only reachable via this service-role client, exactly as designed.
  const { data: customerId } = await adminClient.rpc('find_customer_by_phone', {
    p_restaurant_id: (restaurant as any).id,
    p_phone: payload.fromPhone,
  });

  const { data: conversation, error: conversationError } = await adminClient
    .from('ai_conversations')
    .insert({
      restaurant_id: (restaurant as any).id,
      customer_id: customerId ?? null,
      channel: 'voice',
      caller_phone: payload.fromPhone,
      locale,
    })
    .select('id')
    .single();

  if (conversationError) {
    console.error('voice-webhook: could not log conversation', conversationError);
    // Still answer the caller politely -- a logging failure should never
    // turn into a dead phone line.
    return xmlResponse(buildSayOnlyTwiml(message, locale));
  }

  await adminClient.from('ai_messages').insert([
    { conversation_id: conversation.id, role: 'user', content: payload.speechResult ?? '[call connected, no speech gathered]' },
    { conversation_id: conversation.id, role: 'assistant', content: message },
  ]);

  return xmlResponse(buildSayOnlyTwiml(message, locale));
});
