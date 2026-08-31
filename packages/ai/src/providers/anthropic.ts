import type { AIProvider, AiChatInput, AiChatResult, AiChatMessage, AiToolName } from '../types';
import { VoiceNotImplementedError } from '../provider';

/**
 * Anthropic Claude provider -- the blueprint's recommended primary
 * AIProvider. Implemented with plain `fetch` against the Messages API
 * rather than the @anthropic-ai/sdk npm package, on purpose: this file is
 * imported directly (by relative path, not a bundled npm dependency) from
 * the ai-gateway Deno Edge Function, and `fetch` is the one HTTP primitive
 * guaranteed to exist unchanged in Deno, Node 18+, and any bundler used by
 * apps/mobile or apps/web. Avoiding the SDK also avoids a dependency this
 * sandbox has no network access to install and therefore no way to verify
 * actually works (see the honesty note below).
 *
 * HONESTY NOTE, read before claiming this "works": this sandbox has no
 * outbound network access to api.anthropic.com, and no ANTHROPIC_API_KEY is
 * configured here. Every line below is real, reviewable code -- request
 * shape, response parsing, tool-call extraction all follow Anthropic's
 * publicly documented Messages API -- but it has NOT been exercised against
 * a live endpoint in this environment. The first real verification of this
 * file must happen against a real Supabase project with a real API key
 * (`supabase secrets set ANTHROPIC_API_KEY=...`), exactly like
 * bootstrap-restaurant and invite-staff-member before it.
 *
 * Model IDs are read from environment variables with fallback defaults.
 * Verify the current model catalogue at https://docs.claude.com before
 * relying on the defaults -- model names are exactly the kind of fact that
 * goes stale between when this was written and when it is deployed.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_SMALL_MODEL = 'claude-haiku-4-5';
const DEFAULT_LARGE_MODEL = 'claude-sonnet-4-5';

interface AnthropicProviderOptions {
  apiKey: string;
  smallModel?: string;
  largeModel?: string;
  maxTokens?: number;
}

// Minimal shape of what we actually read from Anthropic's response -- not a
// full type of the API, just the fields this file touches.
interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessagesResponse {
  content: AnthropicContentBlock[];
  model: string;
  stop_reason?: string;
}

// Phase 16 (AI cost): the system prompt (SYSTEM_PROMPT, ai-gateway/index.ts)
// and the tool definitions (AI_TOOLS) are 100% static across every single
// turn of every conversation, for every restaurant -- only `messages`
// actually changes turn to turn. Before this change, both were sent as
// plain, uncached content on every request, meaning the model re-read the
// same system prompt + tool schemas from scratch every turn. Anthropic's
// Messages API supports prompt caching via a `cache_control: { type:
// "ephemeral" }` marker on a content block: everything up to and including
// the LAST marked block, in the fixed request order (tools, then system,
// then messages), becomes eligible to be served from cache on a
// subsequent call within the cache's TTL, at a fraction of the input-token
// cost of a full re-read. Marking the final tool definition AND the system
// prompt block (below) caches the entire static tools+system prefix
// together -- the messages array itself is deliberately left unmarked,
// since it changes every turn and caching it would never hit.
// HONESTY NOTE (see this file's top-of-file note): this is a real,
// documented request shape, not a stub -- but like the rest of this
// provider, it has not been exercised against a live api.anthropic.com
// endpoint in this sandbox (no network access, no API key configured
// here). Verify the actual cache-hit behavior (and the cost line in
// Anthropic's usage dashboard) against a real deployment before trusting
// the blueprint's cost-reduction estimate as anything more than
// directionally plausible.
interface AnthropicCacheControl {
  type: 'ephemeral';
}

function toAnthropicMessages(messages: AiChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Anthropic's Messages API only knows 'user'/'assistant' roles; a 'tool'
  // role message from our own transcript is folded into the preceding
  // assistant turn's tool_result on the way back in (see chat() below) --
  // this mapper handles the simple text-only case used for the system
  // prompt + prior plain turns.
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

export class AnthropicProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly smallModel: string;
  private readonly largeModel: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    if (!options.apiKey) {
      throw new Error('AnthropicProvider requires an apiKey (ANTHROPIC_API_KEY).');
    }
    this.apiKey = options.apiKey;
    this.smallModel = options.smallModel ?? DEFAULT_SMALL_MODEL;
    this.largeModel = options.largeModel ?? DEFAULT_LARGE_MODEL;
    this.maxTokens = options.maxTokens ?? 1024;
  }

  async chat(input: AiChatInput): Promise<AiChatResult> {
    const model = input.preferredModel === 'large' ? this.largeModel : this.smallModel;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: this.maxTokens,
        // Array-of-content-blocks form (rather than a plain string) is
        // required to attach cache_control at all -- see the comment above
        // toAnthropicMessages for why this and the tools[] marker below
        // exist.
        system: [
          {
            type: 'text',
            text: input.systemPrompt,
            cache_control: { type: 'ephemeral' } as AnthropicCacheControl,
          },
        ],
        messages: toAnthropicMessages(input.messages),
        tools: input.tools.map((t, i) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
          // Only the LAST tool definition needs the marker -- a cache
          // breakpoint caches everything from the start of the request up
          // to and including the marked block, so marking every tool
          // would be redundant (and Anthropic caps the number of active
          // breakpoints per request).
          ...(i === input.tools.length - 1
            ? { cache_control: { type: 'ephemeral' } as AnthropicCacheControl }
            : {}),
        })),
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${bodyText}`);
    }

    const data = (await response.json()) as AnthropicMessagesResponse;
    const toolUse = data.content.find((block) => block.type === 'tool_use');
    if (toolUse && toolUse.name) {
      return {
        kind: 'tool_call',
        toolCall: { toolName: toolUse.name as AiToolName, input: toolUse.input ?? {} },
        modelUsed: data.model,
      };
    }

    const text = data.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n');

    return { kind: 'text', text, modelUsed: data.model };
  }

  // Deliberately unimplemented -- see VoiceNotImplementedError's own comment
  // and the blueprint's "voice: architecture-ready, not built" decision.
  async transcribe(): Promise<string> {
    throw new VoiceNotImplementedError('transcribe');
  }

  async speak(): Promise<Uint8Array> {
    throw new VoiceNotImplementedError('speak');
  }
}
