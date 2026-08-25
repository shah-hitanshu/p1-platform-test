// The OpenAI-compatible gateway endpoint (/ai/v1/chat/completions), which fronts `@cf/*`
// Workers AI ids, `openai/*` and `google-ai-studio/*` alike.
import OpenAI from 'openai';
import { toOpenAiTools } from '../tools/definitions.js';
import { restApiBase, fetchOption } from './gateway.js';
import type {
  StopReason,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  FnToolCall,
  ModelTransport,
  StreamHandlers,
  TransportConfig,
} from './transport.js';

type ToolCallDelta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall;

/** A call being assembled: `arguments` arrives in pieces across chunks. */
interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Assembles tool calls from a stream. Providers fragment and interleave them, keyed by `index`,
 * so a call is only whole at the end — but its name lands early enough to announce the step.
 */
export class ToolCallAccumulator {
  private readonly partials = new Map<number, PartialCall>();
  private readonly announced = new Set<number>();

  /** Fold in one delta, returning the call to announce the first time its name is known. */
  accept(delta: ToolCallDelta): { id: string; name: string } | undefined {
    const slot = this.partials.get(delta.index) ?? { id: '', name: '', args: '' };
    if (delta.id) slot.id = delta.id;
    if (delta.function?.name) slot.name += delta.function.name;
    if (delta.function?.arguments) slot.args += delta.function.arguments;
    this.partials.set(delta.index, slot);

    // On the name alone: waiting for an id would drop the call entirely on a provider
    // that omits one.
    if (this.announced.has(delta.index) || !slot.name) return undefined;
    this.announced.add(delta.index);
    return { id: callId(slot, delta.index), name: slot.name };
  }

  /** The assembled calls, in the order the provider indexed them. */
  finish(): FnToolCall[] {
    return [...this.partials.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, slot]) => ({
        id: callId(slot, index),
        type: 'function' as const,
        function: { name: slot.name, arguments: slot.args },
      }));
  }
}

/** Tool-call id, falling back to the stream index for providers that send none. */
function callId(slot: { id: string }, index: number): string {
  return slot.id || `call_${index}`;
}

function mapOpenAiStopReason(reason: string | null | undefined): StopReason | undefined {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool_calls';
    // Absent, not unrecognized: a provider that reports nothing must not read as truncated.
    case null: case undefined: return undefined;
    default: return 'other';
  }
}

function mapOpenAiUsage(usage: OpenAI.CompletionUsage | undefined): CompletionUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    // OpenAI/Gemini/Workers AI cache automatically and only report a read count.
    cacheReadInputTokens: usage.prompt_tokens_details?.cached_tokens,
  };
}

export class OpenAITransport implements ModelTransport {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly tools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[];

  constructor(cfg: TransportConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiToken,
      baseURL: `${restApiBase(cfg.accountId)}/v1`,
      defaultHeaders: { 'cf-aig-gateway-id': cfg.gatewayId },
      ...fetchOption(cfg.fetcher),
    });
    this.model = cfg.model; // full provider/model string
    this.tools = toOpenAiTools(cfg.tools);
  }

  /**
   * The request body both `complete` and `stream` send, less the streaming flags. The SDK's own
   * params type, so an unknown field fails to compile — but it tracks OpenAI's API, not the
   * gateway's other providers, so `max_tokens` stays despite being deprecated there.
   */
  private requestBody(req: CompletionRequest): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: req.maxTokens,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      tools: this.tools,
      tool_choice: 'auto',
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const completion = await this.client.chat.completions.create(this.requestBody(req));

    const choice = completion.choices[0]?.message;
    if (!choice) throw new Error('Model returned no choices');

    const toolCalls = (choice.tool_calls ?? []).filter(
      (tc): tc is FnToolCall => tc.type === 'function',
    );

    return {
      content: choice.content ?? '',
      toolCalls,
      usage: mapOpenAiUsage(completion.usage),
      stopReason: mapOpenAiStopReason(completion.choices[0]?.finish_reason),
    };
  }

  async stream(
    req: CompletionRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    const stream = await this.client.chat.completions.create({
      ...this.requestBody(req),
      stream: true,
      // OpenAI-only: the compat endpoint also fronts Workers AI and Google, and a provider
      // that rejects an unrecognized field fails the whole request.
      ...(this.model.startsWith('openai/') ? { stream_options: { include_usage: true } } : {}),
    }, { signal });

    let content = '';
    let usage: OpenAI.CompletionUsage | undefined;
    let finishReason: string | null | undefined;
    const toolCalls = new ToolCallAccumulator();

    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      // Arrives on the final chunk for the choice, after which `delta` is empty — read it
      // before the guard below skips the chunk.
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        handlers.onText(delta.content);
      }

      for (const tc of delta.tool_calls ?? []) {
        const announcement = toolCalls.accept(tc);
        if (announcement) handlers.onToolCallStart(announcement);
      }
    }

    return {
      content,
      toolCalls: toolCalls.finish(),
      usage: mapOpenAiUsage(usage),
      stopReason: mapOpenAiStopReason(finishReason),
    };
  }
}
