import Anthropic from '@anthropic-ai/sdk';
import { type RawTool } from '../tools/definitions.js';
import { parseDataUrl } from './vision.js';
import { restApiBase, fetchOption } from './gateway.js';
import type {
  ChatMessage,
  StopReason,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  FnToolCall,
  ModelTransport,
  StreamHandlers,
  TransportConfig,
} from './transport.js';

// Anthropic transport for the AI Gateway `/ai/v1/messages` endpoint. The agentic loop
// speaks OpenAI shapes, so this module owns the OpenAI<->Anthropic conversion plus the
// `cache_control` breakpoints that give Claude prompt caching (which the OpenAI-compat
// endpoint can't express). The pure adapter functions are exported for unit testing.

const EPHEMERAL: Anthropic.CacheControlEphemeral = { type: 'ephemeral' };

function safeParse(args: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(args || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

// OpenAI message content is stored as a string, but be defensive about array content.
function coerceText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('');
  }
  return content == null ? '' : String(content);
}

/** Narrower than the OpenAI endpoint's list: AVIF is absent. */
const ANTHROPIC_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

function anthropicImageType(value: string): (typeof ANTHROPIC_IMAGE_TYPES)[number] | null {
  return ANTHROPIC_IMAGE_TYPES.find(type => type === value) ?? null;
}

/**
 * A user message's blocks. `coerceText` keeps only `.text`, so routing user content through it
 * dropped an attached image silently, prompt included.
 */
function userBlocks(content: unknown): Anthropic.ContentBlockParam[] {
  if (!Array.isArray(content)) return [{ type: 'text', text: coerceText(content) }];

  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const part of content) {
    if (part === null || typeof part !== 'object') continue;
    const { type } = part as { type?: unknown };
    if (type === 'text') {
      const { text } = part as { text?: unknown };
      if (typeof text === 'string' && text !== '') blocks.push({ type: 'text', text });
      continue;
    }
    if (type !== 'image_url') continue;
    const { image_url: imageUrl } = part as { image_url?: { url?: unknown } };
    if (typeof imageUrl?.url !== 'string') continue;
    const parsed = parseDataUrl(imageUrl.url);
    if (parsed === null) continue;
    // Skipped, not passed through: one unsupported media type fails the whole request, which
    // would lose the message with the image.
    const mediaType = anthropicImageType(parsed.mediaType);
    if (mediaType === null) continue;
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: parsed.data },
    });
  }

  // Content we recognised nothing in still travels as its text: Anthropic rejects a message
  // with no blocks at all, which would lose the turn rather than the part we could not read.
  return blocks.length > 0 ? blocks : [{ type: 'text', text: coerceText(content) }];
}

type Intermediate = { role: 'user' | 'assistant'; content: Anthropic.ContentBlockParam[] };

/**
 * Convert OpenAI-shaped history to Anthropic messages: drop empty assistant text blocks and
 * orphaned tool results, turn results into `tool_result` blocks inside a user message, and
 * merge consecutive same-role messages (Anthropic requires strict alternation).
 *
 * Live whenever `AGENT_MODEL` carries an `anthropic/` prefix, which selects this transport.
 */
export function toAnthropicMessages(history: ChatMessage[]): Anthropic.MessageParam[] {
  const seenToolUseIds = new Set<string>();
  const intermediates: Intermediate[] = [];

  for (const msg of history) {
    switch (msg.role) {
      case 'user':
        intermediates.push({ role: 'user', content: userBlocks(msg.content) });
        break;
      case 'assistant': {
        const blocks: Anthropic.ContentBlockParam[] = [];
        const text = coerceText(msg.content);
        if (text) blocks.push({ type: 'text', text });
        const toolCalls = (msg.tool_calls ?? []).filter((tc): tc is FnToolCall => tc.type === 'function');
        for (const tc of toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeParse(tc.function.arguments) });
          seenToolUseIds.add(tc.id);
        }
        if (blocks.length > 0) intermediates.push({ role: 'assistant', content: blocks });
        break;
      }
      case 'tool': {
        if (!seenToolUseIds.has(msg.tool_call_id)) break; // orphaned result — drop
        intermediates.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: coerceText(msg.content) }],
        });
        break;
      }
      default:
        break; // system / function / unknown — drop (system is a top-level param)
    }
  }

  // Drop leading entries that can't legally open an Anthropic conversation: assistant
  // messages, and user turns that lead with a tool_result (its tool_use was dropped, so
  // it's an orphan). Each intermediate holds exactly one block here (pre-merge), so
  // checking content[0] is sufficient. Anthropic requires the first message to be a user
  // message that does not begin with a tool_result.
  while (
    intermediates.length > 0 &&
    (intermediates[0].role !== 'user' || intermediates[0].content[0]?.type === 'tool_result')
  ) {
    intermediates.shift();
  }

  // Merge consecutive same-role entries into one message.
  const merged: Anthropic.MessageParam[] = [];
  for (const it of intermediates) {
    const last = merged[merged.length - 1];
    if (last && last.role === it.role) {
      (last.content as Anthropic.ContentBlockParam[]).push(...it.content);
    } else {
      merged.push({ role: it.role, content: it.content });
    }
  }
  return merged;
}

/**
 * Convert provider-neutral tool specs to Anthropic tools (near pass-through —
 * `RawTool.input_schema` is already Anthropic-native). A `cache_control` breakpoint on the
 * last tool caches the whole frozen, deterministically-ordered tool block.
 */
export function toAnthropicTools(raw: RawTool[]): Anthropic.Tool[] {
  return raw.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    ...(i === raw.length - 1 ? { cache_control: EPHEMERAL } : {}),
  }));
}

/**
 * Attach a rolling `cache_control` breakpoint to the final block of the last message, so
 * the message prefix caches turn-to-turn on top of the (already cached) tools + system.
 * Returns a shallow copy; the input is not mutated.
 */
export function withRollingBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const blocks = Array.isArray(last.content)
    ? last.content.slice()
    : [{ type: 'text', text: String(last.content) } as Anthropic.ContentBlockParam];
  if (blocks.length === 0) return messages;
  // Cast: cache_control is valid on the text/tool_use/tool_result blocks we emit, but the
  // ContentBlockParam union also includes thinking blocks that don't accept it.
  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: EPHEMERAL,
  } as Anthropic.ContentBlockParam;
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

function mapAnthropicStopReason(reason: Anthropic.Message['stop_reason']): StopReason | undefined {
  switch (reason) {
    case 'end_turn': case 'stop_sequence': return 'stop';
    case 'max_tokens': return 'length';
    case 'tool_use': return 'tool_calls';
    // Absent, not unrecognized: streaming reports none until the final message_delta.
    case null: case undefined: return undefined;
    default: return 'other';
  }
}

/** Normalize an Anthropic response into the OpenAI-shaped {@link CompletionResult} the loop expects. */
export function fromAnthropicResponse(msg: Anthropic.Message): CompletionResult {
  let content = '';
  const toolCalls: FnToolCall[] = [];
  for (const block of msg.content) {
    if (block.type === 'text') {
      content += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  return {
    content,
    toolCalls,
    usage: mapAnthropicUsage(msg.usage),
    stopReason: mapAnthropicStopReason(msg.stop_reason),
  };
}

function mapAnthropicUsage(usage: Anthropic.Usage | undefined): CompletionUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
  };
}

/** {@link ModelTransport} for `anthropic/*` models via the AI Gateway `/ai/v1/messages` endpoint. */
export class AnthropicTransport implements ModelTransport {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly tools: Anthropic.Tool[];

  constructor(cfg: TransportConfig) {
    this.client = new Anthropic({
      // Bearer auth via the Cloudflare API token — NOT apiKey (which sets x-api-key,
      // the direct-Anthropic header the gateway REST API does not accept).
      authToken: cfg.apiToken,
      baseURL: restApiBase(cfg.accountId),
      defaultHeaders: { 'cf-aig-gateway-id': cfg.gatewayId },
      ...fetchOption(cfg.fetcher),
    });
    // The REST /ai/v1/messages endpoint expects the provider-prefixed id (e.g.
    // "anthropic/claude-sonnet-4-5") — unlike the old path-based /anthropic endpoint,
    // which used a bare id. Send the full AGENT_MODEL string as-is.
    this.model = cfg.model;
    this.tools = toAnthropicTools(cfg.tools);
  }

  /** Request body shared by the streaming and non-streaming paths, so cache breakpoints can't drift between them. */
  private body(req: CompletionRequest): Omit<Anthropic.MessageCreateParams, 'stream'> {
    return {
      model: this.model,
      max_tokens: req.maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      system: [{ type: 'text', text: req.system, cache_control: EPHEMERAL }],
      tools: this.tools,
      messages: withRollingBreakpoint(toAnthropicMessages(req.messages)),
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return fromAnthropicResponse(await this.client.messages.create(this.body(req)));
  }

  async stream(
    req: CompletionRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    const stream = this.client.messages.stream(this.body(req), { signal });

    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        handlers.onToolCallStart({ id: event.content_block.id, name: event.content_block.name });
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        handlers.onText(event.delta.text);
      }
    }

    // finalMessage() reassembles the blocks, so the non-streaming normalizer applies.
    return fromAnthropicResponse(await stream.finalMessage());
  }
}
