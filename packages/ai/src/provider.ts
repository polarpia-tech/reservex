/**
 * Two-model-size cost strategy (blueprint Part 05): route simple,
 * short, tool-free-so-far turns to a small/fast model, and anything longer
 * or already mid-tool-chain to a larger model. This is a plain heuristic,
 * not a learned router -- it is meant to be easy to audit and to tune, not
 * clever. The blueprint's claimed 70-80% cost reduction is THEIR estimate
 * for a mature product's real traffic mix; nothing in this sandbox can
 * measure an actual cost reduction (no live API calls happen here at all --
 * see AnthropicProvider's header comment), so that number is not repeated
 * as a verified fact anywhere in this codebase's own docs.
 */
export function selectModel(input: { messageCount: number; hasPriorToolCall: boolean }): 'small' | 'large' {
  if (input.hasPriorToolCall) return 'large';
  if (input.messageCount > 6) return 'large';
  return 'small';
}

export class VoiceNotImplementedError extends Error {
  constructor(capability: 'transcribe' | 'speak') {
    super(
      `${capability}() is not implemented. Voice (STT/TTS) is deliberately out of scope for the AI Gateway as of Phase 10 -- ` +
        'a phone/voice AI receptionist has zero error tolerance and voice tech is not considered reliable enough yet for ' +
        'irreversible actions like bookings/cancellations. See the blueprint, Part 05, "architecture-ready, not built".',
    );
  }
}

export { type AIProvider, type AiChatInput, type AiChatResult, type AiChatMessage, type AiToolCallRequest } from './types';
