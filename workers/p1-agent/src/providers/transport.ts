import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { RawTool } from '../tools/definitions.js';
import { AnthropicTransport } from './anthropic.js';
import { OpenAITransport } from './openai.js';

// A model provider transport abstracts the two Cloudflare AI Gateway REST endpoints:
//   - /ai/v1/chat/completions (OpenAI-compatible) — @cf/* (Workers AI), openai/*, google-ai-studio/*
//   - /ai/v1/messages (Anthropic-native) — anthropic/*
// The agentic loop in durable-objects/chat-agent.ts stays entirely in OpenAI message shapes
// (the persisted DO history format); each transport converts to/from its wire format internally.

/** OpenAI-shaped chat message — the canonical format the agentic loop and DO history use. */
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** A function tool call in OpenAI shape (the only tool-call kind the loop handles). */
export type FnToolCall = Extract<
  OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  { type: 'function' }
>;

/** A single, provider-agnostic model completion request. */
export interface CompletionRequest {
  /** System prompt, sent as the cacheable prefix. */
  system: string;
  /** Conversation so far, OpenAI-shaped (the loop's canonical format). */
  messages: ChatMessage[];
  /** Max output tokens. */
  maxTokens: number;
  /** Sampling temperature. Omitted leaves the provider default. */
  temperature?: number;
}

/**
 * Prompt-cache accounting. Native/OpenAI/Gemini cache automatically (only a read count is
 * exposed); Anthropic reports both a creation (write) and a read count.
 */
export interface CompletionUsage {
  /** Input (prompt) tokens billed. */
  inputTokens?: number;
  /** Output (completion) tokens billed. */
  outputTokens?: number;
  /** Tokens written to the prompt cache (Anthropic reports this; others don't). */
  cacheCreationInputTokens?: number;
  /** Tokens served from the prompt cache. */
  cacheReadInputTokens?: number;
}

/**
 * Why the model stopped, normalized across providers. `length` means the reply was cut at
 * `maxTokens`, so a tool call it carries may be truncated mid-JSON.
 */
export type StopReason = 'stop' | 'length' | 'tool_calls' | 'other';

/** A normalized completion, always in OpenAI shape regardless of the underlying provider. */
export interface CompletionResult {
  /** Assistant text; `''` when the model produced no text. */
  content: string;
  /** Tool calls in OpenAI function-call shape (the Anthropic transport synthesizes these). */
  toolCalls: FnToolCall[];
  /** Token/cache accounting, when the provider reports it. */
  usage?: CompletionUsage;
  stopReason?: StopReason;
}

/** Fired while a completion is in flight. Best-effort; the resolved result is authoritative. */
export interface StreamHandlers {
  /** A chunk of assistant text, in order. Concatenating every delta yields the final content. */
  onText(delta: string): void;
  /** Fired once per call as soon as its name is known, before its arguments finish streaming. */
  onToolCallStart(call: { id: string; name: string }): void;
}

/** Sends a completion request to a provider and returns a normalized result. */
export interface ModelTransport {
  /** Non-streaming completion. Kept for callers that only need the final result (e.g. the cache smoke test). */
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /**
   * Streaming completion, returning the same normalized result once the stream closes.
   * `signal` aborts the HTTP request, so a cancelled turn stops paying for output tokens.
   */
  stream(req: CompletionRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<CompletionResult>;
}

/** True when `err` is a request abort (either SDK, or the underlying fetch) rather than a failure. */
export function isAbortError(err: unknown): boolean {
  if (err instanceof OpenAI.APIUserAbortError || err instanceof Anthropic.APIUserAbortError) return true;
  return err instanceof Error && err.name === 'AbortError';
}

/** Everything a transport needs to talk to the AI Gateway REST API. */
export interface TransportConfig {
  /** Cloudflare account id (`AI_GATEWAY_ACCOUNT_ID`) — used in the REST path. */
  accountId: string;
  /** AI Gateway name (`AI_GATEWAY_NAME`) — sent as the `cf-aig-gateway-id` header. */
  gatewayId: string;
  /** Cloudflare API token (`AI_GATEWAY_API_TOKEN`) — Bearer auth. */
  apiToken: string;
  /** Model in `provider/model` notation, e.g. `anthropic/claude-sonnet-4-5`. */
  model: string;
  /** Provider-neutral tool specs to expose to the model. */
  tools: RawTool[];
  /** Injected in tests; the SDKs use global fetch when omitted. */
  fetcher?: typeof fetch;
}

/**
 * Route by the provider prefix of `AGENT_MODEL`: `anthropic/*` uses the Anthropic transport
 * (`/ai/v1/messages`); everything else is OpenAI-compatible on `/ai/v1/chat/completions`
 * (bare @cf/* Workers AI ids, openai/*, google-ai-studio/*, …). Throws if the model isn't `provider/model`.
 */
export function createTransport(cfg: TransportConfig): ModelTransport {
  const slash = cfg.model.indexOf('/');
  if (slash <= 0 || slash === cfg.model.length - 1) {
    throw new Error(`AGENT_MODEL must be in provider/model notation, got: "${cfg.model}"`);
  }
  const provider = cfg.model.slice(0, slash);
  if (provider === 'anthropic') return new AnthropicTransport(cfg);
  return new OpenAITransport(cfg);
}

/**
 * HTTP status of a provider API error (either SDK), else `undefined` — so the caller's
 * rate-limit handling works regardless of which transport ran.
 */
export function apiErrorStatus(err: unknown): number | undefined {
  if (err instanceof OpenAI.APIError) return err.status;
  if (err instanceof Anthropic.APIError) return err.status;
  return undefined;
}
