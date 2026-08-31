// deno-lint-ignore-file no-explicit-any
import { handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { AuthError, createAdminClient, createCallerClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts';
import { AI_TOOLS, findToolDefinition } from '../../../packages/ai/src/tools.ts';
import { AnthropicProvider } from '../../../packages/ai/src/providers/anthropic.ts';
import type { AiChatMessage } from '../../../packages/ai/src/types.ts';
import { selectModel } from '../../../packages/ai/src/provider.ts';
import { AuthorizationError, TOOL_EXECUTORS, ValidationError } from './tools.ts';

/**
 * ai-gateway
 * ==========
 * The ONLY entry point through which the AI ever touches ReservX data. This
 * mirrors why bootstrap-restaurant and invite-staff-member are Edge
 * Functions rather than plain SQL functions -- but here the reason is even
 * stronger: 0011's RLS leaves `ai_actions` (and, for any channel, `ai_
 * messages`) with NO insert policy for the authenticated role at all. There
 * is no SECURITY DEFINER SQL shortcut available even if we wanted one; the
 * service role is the only way to record a conversation, a message, or an
 * action, by design (see 0017's migration comment).
 *
 * Two request shapes, one function:
 *   POST { action: 'chat',    conversationId?, restaurantId, channel?, locale?, message }
 *   POST { action: 'confirm', actionId }
 *   POST { action: 'reject',  actionId }
 *
 * Scope note (read before assuming more than what's here): this Phase 10
 * build only wires up `channel: 'staff_chat'`. `customer_chat`/`voice`/
 * `whatsapp` remain schema-ready (0009) but have no executor path and no UI
 * anywhere in this codebase yet -- a customer-facing AI chat is a real,
 * separate feature that needs its own product decisions (rate limiting,
 * anonymous-guest identity, escalation to a human) and is deliberately not
 * built here. Voice (transcribe/speak) is unimplemented on purpose --
 * see packages/ai/src/provider.ts's VoiceNotImplementedError.
 *
 * HONESTY NOTE: this function has not been deployed or exercised against a
 * live Supabase project or a live Anthropic endpoint in this sandbox (no
 * network access, no Deno runtime here to even `deno check` it). Every
 * authorization/validation/audit-logging code path below is written to the
 * same standard as the rest of this codebase, but "the AI actually replies
 * correctly" can only be verified once this is deployed with a real
 * ANTHROPIC_API_KEY secret. What CAN be, and was, verified in this sandbox
 * is everything the SQL layer is responsible for: the ai_actions status
 * machine, the RLS boundaries around ai_conversations/ai_messages/
 * ai_actions, and get_reservation_analytics -- see
 * scripts/verify_phase10_ai_gateway.sql.
 */

const SYSTEM_PROMPT = `You are the ReservX staff assistant. You help restaurant staff check availability, look up reservations, see analytics, and manage bookings.

You may ONLY act through the tools you are given -- never claim to have done something you did not call a tool for. Any tool that changes data will show the human a confirmation prompt before it actually happens; you do not need to ask for confirmation yourself, the system handles that. Be concise and specific: use real dates/times/numbers from tool results, not vague language.`;

interface ChatRequestBody {
  action?: 'chat' | 'confirm' | 'reject';
  conversationId?: string;
  restaurantId?: string;
  channel?: string;
  locale?: string;
  message?: string;
  actionId?: string;
}

async function loadOrCreateConversation(
  adminClient: any,
  callerId: string,
  restaurantId: string,
  conversationId: string | undefined,
  locale: string | undefined,
) {
  if (conversationId) {
    const { data, error } = await adminClient.from('ai_conversations').select('*').eq('id', conversationId).single();
    if (error) throw error;
    if (data.user_id !== callerId) throw new AuthorizationError('This conversation does not belong to you.');
    return data;
  }
  const { data, error } = await adminClient
    .from('ai_conversations')
    .insert({ restaurant_id: restaurantId, user_id: callerId, channel: 'staff_chat', locale: locale ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Phase 16 (AI cost): loadHistory() had NO limit at all -- every turn of a
// long-running conversation re-sent its ENTIRE history to the model, so
// cost per turn grew unboundedly with conversation length instead of
// staying roughly flat. This is the single largest real cost driver in a
// multi-turn chat integration, well ahead of the model-tier selection
// selectModel() already does (packages/ai/src/provider.ts) or the prompt
// caching added below in packages/ai/src/providers/anthropic.ts -- both of
// those optimize the STATIC prefix (system prompt + tools) sent every
// turn, not the ever-growing conversational history itself.
// MAX_HISTORY_MESSAGES caps how many of the most recent messages are sent.
// Fetched newest-first with a LIMIT (cheap, uses the existing
// (conversation_id, created_at) access pattern), then reversed back to
// chronological order in JS -- fetching oldest-first with a LIMIT would
// instead return the OLDEST N messages, the opposite of what a chat
// history cap needs. 20 is a starting point, not a tuned constant: it is
// enough for the kind of short, transactional "book me a table for 4"
// exchanges this Gateway is built for (Phase 10), and easy to raise later
// if real usage shows longer conversations need more context. This does
// mean a conversation that legitimately runs past 20 messages loses its
// earliest turns from the model's context -- an explicit, honest
// trade-off (bounded cost) rather than a hidden one; nothing today
// summarizes or otherwise preserves what falls off the end.
const MAX_HISTORY_MESSAGES = 20;

async function loadHistory(adminClient: any, conversationId: string): Promise<AiChatMessage[]> {
  const { data, error } = await adminClient
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);
  if (error) throw error;
  return (data ?? []).reverse().map((row: any) => ({ role: row.role, content: row.content ?? '' }));
}

async function insertMessage(adminClient: any, conversationId: string, message: Partial<any>) {
  const { error } = await adminClient.from('ai_messages').insert({ conversation_id: conversationId, ...message });
  if (error) throw error;
}

async function logAction(
  adminClient: any,
  conversationId: string,
  restaurantId: string,
  toolName: string,
  input: Record<string, any>,
  requiresConfirmation: boolean,
  status: 'proposed' | 'executed' | 'failed',
  extra: Partial<any> = {},
) {
  const { data, error } = await adminClient
    .from('ai_actions')
    .insert({
      conversation_id: conversationId,
      restaurant_id: restaurantId,
      tool_name: toolName,
      input,
      requires_confirmation: requiresConfirmation,
      status,
      ...extra,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function getProvider() {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured for this function -- see this function\'s header comment.');
  }
  return new AnthropicProvider({
    apiKey,
    smallModel: Deno.env.get('ANTHROPIC_MODEL_SMALL') ?? undefined,
    largeModel: Deno.env.get('ANTHROPIC_MODEL_LARGE') ?? undefined,
  });
}

async function handleChat(req: Request, callerId: string, body: ChatRequestBody) {
  if ((body.channel ?? 'staff_chat') !== 'staff_chat') {
    return jsonError('Only channel "staff_chat" is implemented in this phase.', 400);
  }
  if (!body.restaurantId) return jsonError('restaurantId is required.', 400);
  if (!body.message || !body.message.trim()) return jsonError('message is required.', 400);

  const callerClient = createCallerClient(req);
  const adminClient = createAdminClient();

  const isMember = await (async () => {
    const { data, error } = await callerClient.rpc('is_restaurant_member', { target_restaurant_id: body.restaurantId });
    if (error) throw error;
    return Boolean(data);
  })();
  if (!isMember) return jsonError('You are not a member of this restaurant.', 403);

  const conversation = await loadOrCreateConversation(adminClient, callerId, body.restaurantId, body.conversationId, body.locale);
  await insertMessage(adminClient, conversation.id, { role: 'user', content: body.message });

  const history = await loadHistory(adminClient, conversation.id);
  const provider = getProvider();
  const preferredModel = selectModel({ messageCount: history.length, hasPriorToolCall: false });

  const result = await provider.chat({
    systemPrompt: SYSTEM_PROMPT,
    messages: history,
    tools: AI_TOOLS,
    preferredModel,
  });

  if (result.kind === 'text') {
    await insertMessage(adminClient, conversation.id, { role: 'assistant', content: result.text ?? '' });
    return jsonResponse({ conversationId: conversation.id, reply: result.text ?? '' });
  }

  // kind === 'tool_call'
  const call = result.toolCall!;
  const def = findToolDefinition(call.toolName);
  const executor = TOOL_EXECUTORS[call.toolName];
  if (!def || !executor) {
    return jsonError(`Unknown tool requested: ${call.toolName}`, 500);
  }

  const ctx = { callerClient, adminClient, callerId };
  try {
    await executor.authorize(ctx, call.input);
  } catch (err) {
    const message = err instanceof AuthorizationError || err instanceof ValidationError ? err.message : 'Could not validate this action.';
    await insertMessage(adminClient, conversation.id, { role: 'assistant', content: `I can't do that: ${message}` });
    return jsonResponse({ conversationId: conversation.id, reply: `I can't do that: ${message}` });
  }

  const summary = executor.summarize(call.input);

  if (!def.requiresConfirmation) {
    // Low risk: execute now, log a completed action, then ask the model for
    // a natural-language answer using the tool's result.
    let toolResult: Record<string, any>;
    let action;
    try {
      toolResult = await executor.run(ctx, call.input);
      action = await logAction(adminClient, conversation.id, body.restaurantId, call.toolName, call.input, false, 'executed', {
        executed_at: new Date().toISOString(),
        result: toolResult,
      });
    } catch (err) {
      await logAction(adminClient, conversation.id, body.restaurantId, call.toolName, call.input, false, 'failed', {
        error_message: err instanceof Error ? err.message : String(err),
      });
      await insertMessage(adminClient, conversation.id, { role: 'assistant', content: `${summary} -- failed.` });
      return jsonError('The tool call failed.', 500);
    }

    await insertMessage(adminClient, conversation.id, {
      role: 'assistant',
      content: summary,
      tool_name: call.toolName,
      tool_input: call.input,
      tool_output: toolResult,
    });

    const followUp = await provider.chat({
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        ...history,
        { role: 'user', content: body.message },
        { role: 'assistant', content: `Tool ${call.toolName} returned: ${JSON.stringify(toolResult)}. Answer the user's question using this data, in plain language.` },
      ],
      tools: AI_TOOLS,
      preferredModel: selectModel({ messageCount: history.length, hasPriorToolCall: true }),
    });

    const replyText = followUp.kind === 'text' ? followUp.text ?? summary : summary;
    await insertMessage(adminClient, conversation.id, { role: 'assistant', content: replyText });
    return jsonResponse({ conversationId: conversation.id, reply: replyText, actionId: action.id, toolResult });
  }

  // Medium/high risk: propose only, do NOT execute.
  const action = await logAction(adminClient, conversation.id, body.restaurantId, call.toolName, call.input, true, 'proposed');
  await insertMessage(adminClient, conversation.id, {
    role: 'assistant',
    content: summary,
    tool_name: call.toolName,
    tool_input: call.input,
  });

  return jsonResponse({
    conversationId: conversation.id,
    proposal: { actionId: action.id, toolName: call.toolName, riskLevel: def.riskLevel, summary },
  });
}

async function handleConfirmOrReject(req: Request, callerId: string, body: ChatRequestBody, decision: 'confirm' | 'reject') {
  if (!body.actionId) return jsonError('actionId is required.', 400);

  const callerClient = createCallerClient(req);
  const adminClient = createAdminClient();

  const { data: action, error } = await adminClient.from('ai_actions').select('*, ai_conversations(user_id, restaurant_id)').eq('id', body.actionId).single();
  if (error || !action) return jsonError('Action not found.', 404);
  if (action.status !== 'proposed') return jsonError(`This action is already ${action.status}.`, 409);
  if (action.ai_conversations?.user_id !== callerId) return jsonError('This action does not belong to you.', 403);

  if (decision === 'reject') {
    await adminClient
      .from('ai_actions')
      .update({ status: 'rejected', confirmed_by_user_id: callerId, confirmed_at: new Date().toISOString() })
      .eq('id', action.id);
    await insertMessage(adminClient, action.conversation_id, { role: 'assistant', content: 'Cancelled -- no changes were made.' });
    return jsonResponse({ status: 'rejected' });
  }

  const executor = TOOL_EXECUTORS[action.tool_name as keyof typeof TOOL_EXECUTORS];
  if (!executor) return jsonError(`Unknown tool: ${action.tool_name}`, 500);

  const ctx = { callerClient, adminClient, callerId };
  try {
    // Re-run authorization from scratch -- never trust the state captured
    // when the action was first proposed (see this file's header comment).
    await executor.authorize(ctx, action.input);
    const result = await executor.run(ctx, action.input);
    await adminClient
      .from('ai_actions')
      .update({
        status: 'executed',
        confirmed_by_user_id: callerId,
        confirmed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        result,
      })
      .eq('id', action.id);
    await insertMessage(adminClient, action.conversation_id, { role: 'assistant', content: `Done -- ${executor.summarize(action.input)}` });
    return jsonResponse({ status: 'executed', result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await adminClient
      .from('ai_actions')
      .update({
        status: 'failed',
        confirmed_by_user_id: callerId,
        confirmed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq('id', action.id);
    await insertMessage(adminClient, action.conversation_id, { role: 'assistant', content: `That failed: ${message}` });
    return jsonError(message, err instanceof AuthorizationError ? 403 : err instanceof ValidationError ? 400 : 500);
  }
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const user = await getAuthenticatedUser(req);
    const body = (await req.json().catch(() => ({}))) as ChatRequestBody;

    if (body.action === 'confirm') return await handleConfirmOrReject(req, user.id, body, 'confirm');
    if (body.action === 'reject') return await handleConfirmOrReject(req, user.id, body, 'reject');
    if (body.action === 'chat' || !body.action) return await handleChat(req, user.id, body);

    return jsonError('Unknown action.', 400);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    if (err instanceof AuthorizationError) return jsonError(err.message, 403);
    if (err instanceof ValidationError) return jsonError(err.message, 400);
    console.error('ai-gateway error', err);
    return jsonError('Internal error.', 500);
  }
});
