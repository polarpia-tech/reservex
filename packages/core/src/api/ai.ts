import type { SupabaseClient } from '@supabase/supabase-js';

import type { AiChatResponse, AiMessage, UUID } from '../types/database';

// ---------------------------------------------------------------------------
// Phase 10: thin client wrapper around the ai-gateway Edge Function. There
// is deliberately no direct table access here for ai_conversations/
// ai_messages/ai_actions writes -- see 0017's migration comment and the
// Edge Function's own header comment for why every write MUST go through
// the service role. Reading conversation history is a plain RLS-scoped
// select, same as any other table.
// ---------------------------------------------------------------------------

async function invokeAiGateway<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('ai-gateway', { body });
  if (error) {
    // Same FunctionsHttpError-unwrapping as inviteStaffMember (staff.ts) --
    // supabase-js hides the real { error: "..." } message on error.context.
    const context = (error as { context?: Response }).context;
    let parsedMessage: string | undefined;
    if (context && typeof context.json === 'function') {
      try {
        const parsed = (await context.json()) as { error?: string };
        parsedMessage = parsed?.error;
      } catch {
        // ignore -- fall back to the generic error below
      }
    }
    throw new Error(parsedMessage ?? error.message);
  }
  return data as T;
}

export interface SendAiChatMessageInput {
  restaurantId: UUID;
  message: string;
  conversationId?: UUID;
  locale?: string;
}

/** Sends one chat turn to the AI Gateway. Returns either a plain reply, or a proposal that still needs confirmAiAction()/rejectAiAction(). */
export function sendAiChatMessage(client: SupabaseClient, input: SendAiChatMessageInput): Promise<AiChatResponse> {
  return invokeAiGateway<AiChatResponse>(client, {
    action: 'chat',
    channel: 'staff_chat',
    restaurantId: input.restaurantId,
    message: input.message,
    conversationId: input.conversationId,
    locale: input.locale,
  });
}

export interface ConfirmAiActionResult {
  status: 'executed';
  result: Record<string, unknown>;
}

export function confirmAiAction(client: SupabaseClient, actionId: UUID): Promise<ConfirmAiActionResult> {
  return invokeAiGateway<ConfirmAiActionResult>(client, { action: 'confirm', actionId });
}

export function rejectAiAction(client: SupabaseClient, actionId: UUID): Promise<{ status: 'rejected' }> {
  return invokeAiGateway<{ status: 'rejected' }>(client, { action: 'reject', actionId });
}

interface AiMessageRow {
  id: string;
  conversation_id: string;
  role: AiMessage['role'];
  content: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  created_at: string;
}

function mapAiMessageRow(row: AiMessageRow): AiMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    toolName: row.tool_name,
    toolInput: row.tool_input,
    toolOutput: row.tool_output,
    createdAt: row.created_at,
  };
}

/** Plain RLS-scoped read -- ai_messages_select (0011) already restricts this to conversations the caller can see. No Edge Function involved. */
export async function fetchAiConversationMessages(client: SupabaseClient, conversationId: UUID): Promise<AiMessage[]> {
  const { data, error } = await client
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as unknown as AiMessageRow[]).map(mapAiMessageRow);
}

export interface AiConversationSummary {
  id: UUID;
  restaurantId: UUID | null;
  startedAt: string;
  endedAt: string | null;
}

/** My own past conversations for this restaurant, newest first -- for a simple "conversation history" list in the UI. */
export async function fetchMyAiConversations(client: SupabaseClient, restaurantId: UUID): Promise<AiConversationSummary[]> {
  const { data, error } = await client
    .from('ai_conversations')
    .select('id, restaurant_id, started_at, ended_at')
    .eq('restaurant_id', restaurantId)
    .eq('channel', 'staff_chat')
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }));
}
