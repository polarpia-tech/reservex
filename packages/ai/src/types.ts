// Shared, runtime-agnostic types for the AI Gateway. Deliberately has ZERO
// dependency on @supabase/supabase-js, Deno, or React Native -- this file is
// imported both by the ai-gateway Edge Function (Deno, via a relative import
// -- see that function's header comment for why) and, in spirit, describes
// the same shapes packages/core's api/ai.ts client wrapper works with. Kept
// framework-free on purpose so it can be imported from either runtime
// without a build step.

/** Matches public.ai_channel (migration 0009). */
export type AiChannel = 'staff_chat' | 'customer_chat' | 'voice' | 'whatsapp';

/** Matches public.ai_message_role (migration 0009). */
export type AiMessageRole = 'user' | 'assistant' | 'tool';

/** Matches public.ai_action_status (migration 0009). */
export type AiActionStatus = 'proposed' | 'confirmed' | 'executed' | 'rejected' | 'failed';

/**
 * The blueprint's own risk tiering (Part 05). `low` never needs confirmation
 * -- it is read-only, and read-only mistakes cost nothing to correct.
 * `medium` and `high` both require confirmation; the distinction is purely
 * about how the confirmation is presented (a bulk cancellation should show
 * an explicit record count, a settings change should show a full diff) --
 * there is no tier that skips confirmation for a write.
 */
export type AiToolRiskLevel = 'low' | 'medium' | 'high';

export type AiToolName =
  | 'findAvailability'
  | 'getReservation'
  | 'getAnalytics'
  | 'createReservation'
  | 'modifyReservation'
  | 'cancelReservation'
  | 'bulkCancelReservations'
  | 'updateRestaurantSettings';

/**
 * One entry in the AI Gateway's closed tool set. `inputSchema` is a plain
 * JSON-Schema-shaped object (not a class from some SDK) so it can be hand-
 * written, logged, and handed to any AIProvider's function-calling API
 * without pulling in a schema-validation library this sandbox cannot
 * install (no network access to npm here -- see README).
 */
export interface AiToolDefinition {
  name: AiToolName;
  description: string;
  riskLevel: AiToolRiskLevel;
  requiresConfirmation: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AiChatMessage {
  role: AiMessageRole;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
}

export interface AiToolCallRequest {
  toolName: AiToolName;
  input: Record<string, unknown>;
}

/**
 * What an AIProvider.chat() call returns: either the model answered in
 * plain text, or it wants to call exactly one tool next. Anthropic's actual
 * Messages API can return several tool_use blocks in one turn; the Gateway
 * deliberately processes at most one tool call per turn (see ai-gateway's
 * header comment) to keep the confirm-before-execute boundary simple to
 * reason about and to audit.
 */
export interface AiChatResult {
  kind: 'text' | 'tool_call';
  text?: string;
  toolCall?: AiToolCallRequest;
  /** Which model actually served this turn -- for the audit trail and for verifying the cost-routing heuristic behaves as intended. */
  modelUsed: string;
}

export interface AiChatInput {
  systemPrompt: string;
  messages: AiChatMessage[];
  tools: AiToolDefinition[];
  /** Hint from selectModel() (see provider.ts) -- the provider is free to ignore it, but the reference AnthropicProvider honors it. */
  preferredModel: 'small' | 'large';
}

/**
 * The abstraction the blueprint asks for: chat() is required, transcribe()/
 * speak() are optional and, for every provider in this codebase today,
 * deliberately unimplemented -- voice is "architecture-ready, not built"
 * (Part 05: proposed for a much later phase, once real-time speech AI is
 * reliable enough for zero-error-tolerance use like a phone receptionist).
 */
export interface AIProvider {
  chat(input: AiChatInput): Promise<AiChatResult>;
  transcribe?(audio: Uint8Array, mimeType: string): Promise<string>;
  speak?(text: string, locale: string): Promise<Uint8Array>;
}
