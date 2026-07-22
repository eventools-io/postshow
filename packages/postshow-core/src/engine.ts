// The multi-provider engine. One entry point (callModel) drives every
// provider in the catalog with the caller's resolved {provider, model,
// effort}. Two wire formats cover everything: Anthropic's native messages
// API, and the OpenAI chat-completions shape that OpenAI, Moonshot, Z.ai,
// DeepSeek, xAI, Mistral, Ollama, and custom compatible endpoints all speak.
// Every call returns token usage so the caller can meter it.

import { type CatalogProvider, type EffortLevel, getProvider, isHostedModel } from './catalog';
import { isLoopbackHostname, isUnsafePublicHostname } from './network';
import type { ResolvedEngine } from './tasks';

export interface ModelCall {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Opt in at the runtime boundary that owns retry cost and reconciliation. */
  retryTransientErrors?: boolean;
}

export interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Present for current engines; optional for backwards-compatible callers and test doubles. */
  usageValid?: boolean;
  /** Number of HTTP attempts used by this call. */
  attempts?: number;
  /** True when any attempt may have been accepted before a transport failure. */
  billingAmbiguous?: boolean;
}

export class ModelRequestError extends Error {
  readonly status: number | null;
  readonly attempts: number;
  readonly billingAmbiguous: boolean;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly usageValid: boolean | null;

  constructor(
    message: string,
    status: number | null,
    attempts: number,
    usage?: { inputTokens: number; outputTokens: number; usageValid: boolean },
    billingAmbiguous?: boolean
  ) {
    super(message);
    this.name = 'ModelRequestError';
    this.status = status;
    this.attempts = attempts;
    this.billingAmbiguous =
      billingAmbiguous ??
      (!usage?.usageValid && attempts > 0 && (status === null || status >= 500 || status === 200));
    this.inputTokens = usage?.inputTokens ?? null;
    this.outputTokens = usage?.outputTokens ?? null;
    this.usageValid = usage?.usageValid ?? null;
  }
}

/** Provider-specific reasoning controls for one request body. Exported for
 * tests: the mapping is the part of the engine most worth pinning down. */
export function reasoningParams(
  provider: string,
  model: string,
  effort: EffortLevel
): Record<string, unknown> {
  switch (provider) {
    case 'anthropic': {
      // Haiku has no effort parameter; every other curated Anthropic model
      // takes output_config.effort with adaptive thinking.
      if (model.startsWith('claude-haiku')) return {};
      const effortMap: Record<EffortLevel, string> = {
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high',
        max: 'max',
      };
      const params: Record<string, unknown> = { output_config: { effort: effortMap[effort] } };
      // Fable 5 always thinks; sending an explicit config is unnecessary.
      if (!model.startsWith('claude-fable')) params.thinking = { type: 'adaptive' };
      return params;
    }
    case 'openai': {
      // reasoning_effort on chat completions; xhigh is the top for 5.4/5.6.
      const effortMap: Record<EffortLevel, string> = {
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high',
        max: 'xhigh',
      };
      return { reasoning_effort: effortMap[effort] };
    }
    case 'moonshot': {
      // Only K3 takes reasoning_effort (low|high|max); K2.x ignores it.
      if (!model.startsWith('kimi-k3')) return {};
      const effortMap: Record<EffortLevel, string> = {
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        max: 'max',
      };
      return { reasoning_effort: effortMap[effort] };
    }
    case 'zhipu': {
      // Current Z.AI Chat Completions exposes thinking.type, not a portable
      // reasoning_effort field.
      if (effort === 'minimal') return { thinking: { type: 'disabled' } };
      return { thinking: { type: 'enabled' } };
    }
    case 'deepseek': {
      // V4 takes thinking enabled/disabled plus reasoning_effort high|max.
      if (effort === 'minimal') return { thinking: { type: 'disabled' } };
      return {
        thinking: { type: 'enabled' },
        reasoning_effort: effort === 'max' ? 'max' : 'high',
      };
    }
    case 'xai': {
      const effortMap: Record<EffortLevel, string> = {
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high',
        max: 'high',
      };
      return { reasoning_effort: effortMap[effort] };
    }
    case 'mistral': {
      // Mistral enables reasoning through prompt_mode. Omit it for the low
      // ladder instead of sending OpenAI's unrelated reasoning_effort field.
      return effort === 'minimal' || effort === 'low' ? {} : { prompt_mode: 'reasoning' };
    }
    default:
      // ollama, compatible: no portable reasoning control.
      return {};
  }
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export const MODEL_TIMEOUT_MS = 90_000;
export const LOCAL_MODEL_TIMEOUT_MS = 10 * 60_000;
export const MODEL_MAX_ATTEMPTS = 3;
const MAX_MODEL_RESPONSE_BYTES = 4 * 1024 * 1024;
const MODEL_RETRY_BASE_MS = 250;
const MODEL_RETRY_AFTER_CAP_MS = 30_000;

/** Resolve the only endpoint a model call may use. Curated providers are
 * pinned to the catalog. Local mode is loopback-only. A custom compatible
 * endpoint may be remote only for BYOK and must use public HTTPS; the cloud
 * runtime additionally performs DNS revalidation before it permits one. */
export function resolveEngineEndpoint(engine: ResolvedEngine, provider: CatalogProvider): string {
  if (engine.mode === 'local' && provider.id !== 'compatible' && provider.id !== 'ollama') {
    throw new Error('local mode only permits Ollama or a loopback-compatible endpoint');
  }
  if (engine.mode === 'hosted' && (!provider.hosted || !isHostedModel(provider.id, engine.model))) {
    throw new Error('this provider/model is not enabled for hosted processing');
  }
  if (provider.id !== 'compatible' && provider.id !== 'ollama') return provider.baseUrl;
  if (engine.mode === 'hosted') throw new Error('hosted mode does not permit custom endpoints');
  if (provider.id === 'ollama' && engine.mode !== 'local') {
    throw new Error('Ollama is available only in local mode');
  }

  const raw = engine.baseUrl || provider.baseUrl;
  if (!raw) throw new Error('this engine needs a base URL; set one in Settings');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('engine base URL is invalid');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('engine base URL cannot contain credentials, query parameters, or a fragment');
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (engine.mode === 'local') {
    if (!loopback || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('local mode only permits a loopback HTTP(S) model endpoint');
    }
  } else if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    loopback ||
    isUnsafePublicHostname(url.hostname)
  ) {
    throw new Error('remote compatible endpoints must use standard-port public HTTPS');
  }
  return trimBase(url.toString());
}

async function readTextBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_MODEL_RESPONSE_BYTES) {
    throw new Error('model response exceeded the 4 MiB safety limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MODEL_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error('model response exceeded the 4 MiB safety limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function retryDelayMs(response: Response, attempt: number): number | null {
  const retryAfter = response.headers.get('retry-after')?.trim() ?? '';
  if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
    const delay = Math.max(0, Number(retryAfter) * 1_000);
    return delay <= MODEL_RETRY_AFTER_CAP_MS ? delay : null;
  }
  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    const delay = Math.max(0, retryAt - Date.now());
    return delay <= MODEL_RETRY_AFTER_CAP_MS ? delay : null;
  }
  const ceiling = MODEL_RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.floor(Math.random() * (ceiling + 1));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchModelJson(
  url: string,
  init: RequestInit,
  timeoutMs = MODEL_TIMEOUT_MS,
  maxAttempts = 1
): Promise<{ data: Record<string, unknown>; attempts: number; billingAmbiguous: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let startedAttempts = 0;
  let billingAmbiguous = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ModelRequestError('model call timed out', null, startedAttempts);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    let retryIn: number | null = null;
    let responseStatus: number | null = null;
    try {
      startedAttempts = attempt;
      const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
      responseStatus = response.status;
      if (response.status >= 500) billingAmbiguous = true;
      if (response.status >= 300 && response.status < 400) {
        throw new Error('model endpoint redirects are not allowed');
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxAttempts) {
        retryIn = retryDelayMs(response, attempt);
        if (retryIn === null || retryIn >= deadline - Date.now()) {
          await response.body?.cancel().catch(() => undefined);
          throw new ModelRequestError(
            `model call failed (${response.status})`,
            response.status,
            attempt,
            undefined,
            billingAmbiguous
          );
        }
        await response.body?.cancel().catch(() => undefined);
      } else {
        const text = await readTextBounded(response);
        if (!response.ok) {
          // Do not surface provider-controlled headers or bodies: compatible
          // endpoints and proxies can reflect credentials into either one.
          throw new ModelRequestError(
            `model call failed (${response.status})`,
            response.status,
            attempt,
            undefined,
            billingAmbiguous
          );
        }
        try {
          return { data: jsonRecord(JSON.parse(text)), attempts: attempt, billingAmbiguous };
        } catch {
          throw new Error('model returned invalid JSON');
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ModelRequestError('model call timed out', null, attempt, undefined, true);
      }
      if (error instanceof ModelRequestError) throw error;
      throw new ModelRequestError(
        error instanceof Error ? error.message : 'model request failed',
        responseStatus,
        attempt,
        undefined,
        billingAmbiguous || responseStatus === null || responseStatus === 200
      );
    } finally {
      clearTimeout(timeout);
    }
    if (retryIn !== null) await sleep(retryIn);
  }
  throw new Error('model retry budget exhausted');
}

function modelUsage(
  usage: Record<string, unknown>,
  inputField: string,
  outputField: string
): { inputTokens: number; outputTokens: number; usageValid: boolean } {
  const rawInput = usage[inputField];
  const rawOutput = usage[outputField];
  const inputValid =
    typeof rawInput === 'number' && Number.isSafeInteger(rawInput) && rawInput >= 0;
  const outputValid =
    typeof rawOutput === 'number' && Number.isSafeInteger(rawOutput) && rawOutput >= 0;
  const inputTokens = inputValid ? rawInput : 0;
  const outputTokens = outputValid ? rawOutput : 0;
  const usageValid = inputValid && outputValid && inputTokens + outputTokens > 0;
  return {
    inputTokens: usageValid ? inputTokens : 0,
    outputTokens: usageValid ? outputTokens : 0,
    usageValid,
  };
}

async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  effort: EffortLevel,
  call: ModelCall,
  maxTokens: number
): Promise<ModelResult> {
  const { data, attempts, billingAmbiguous } = await fetchModelJson(
    `${trimBase(baseUrl)}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.prompt }],
        ...reasoningParams('anthropic', model, effort),
      }),
    },
    MODEL_TIMEOUT_MS,
    call.retryTransientErrors ? MODEL_MAX_ATTEMPTS : 1
  );
  const usage = modelUsage(jsonRecord(data.usage), 'input_tokens', 'output_tokens');
  if (data.stop_reason === 'refusal') {
    throw new ModelRequestError(
      'model refused the request',
      200,
      attempts,
      usage,
      billingAmbiguous
    );
  }
  if (data.stop_reason === 'max_tokens') {
    throw new ModelRequestError(
      'model output was truncated',
      200,
      attempts,
      usage,
      billingAmbiguous
    );
  }
  const text = (Array.isArray(data.content) ? data.content : [])
    .map(jsonRecord)
    .filter((block) => block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
  if (!text.trim()) {
    throw new ModelRequestError(
      'model returned no text output',
      200,
      attempts,
      usage,
      billingAmbiguous
    );
  }
  return {
    text,
    ...usage,
    attempts,
    billingAmbiguous,
  };
}

export function buildOpenAiRequestBody(
  provider: string,
  model: string,
  effort: EffortLevel,
  call: ModelCall,
  maxTokens: number
): Record<string, unknown> {
  const supportsJsonMode = !['compatible', 'ollama'].includes(provider);
  return {
    model,
    ...(provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(supportsJsonMode ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: call.system },
      { role: 'user', content: call.prompt },
    ],
    // Local and custom models often default to creative sampling. A low
    // temperature materially improves their required JSON discipline.
    ...(provider === 'ollama' || provider === 'compatible' ? { temperature: 0.2 } : {}),
    ...reasoningParams(provider, model, effort),
  };
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const row = part as Record<string, unknown>;
      if (typeof row.text === 'string') return row.text;
      if (row.text && typeof row.text === 'object') {
        const nested = row.text as Record<string, unknown>;
        return typeof nested.value === 'string' ? nested.value : '';
      }
      return typeof row.content === 'string' ? row.content : '';
    })
    .join('');
}

export function extractOpenAiText(data: Record<string, unknown>): string {
  const choice = jsonRecord(Array.isArray(data.choices) ? data.choices[0] : undefined);
  const message = jsonRecord(choice.message);
  const finish = String(choice.finish_reason ?? '');
  if (finish === 'length') throw new Error('model output was truncated');
  if (finish === 'content_filter' || message.refusal) {
    throw new Error('model refused the request');
  }
  const text = messageContentText(message.content);
  if (!text.trim()) throw new Error('model returned no text output');
  return text;
}

async function callOpenAiCompatible(
  provider: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  effort: EffortLevel,
  call: ModelCall,
  maxTokens: number,
  timeoutMs: number
): Promise<ModelResult> {
  const { data, attempts, billingAmbiguous } = await fetchModelJson(
    `${trimBase(baseUrl)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(buildOpenAiRequestBody(provider, model, effort, call, maxTokens)),
    },
    timeoutMs,
    call.retryTransientErrors ? MODEL_MAX_ATTEMPTS : 1
  );
  const usage = modelUsage(jsonRecord(data.usage), 'prompt_tokens', 'completion_tokens');
  let text: string;
  try {
    text = extractOpenAiText(data);
  } catch (error) {
    throw new ModelRequestError(
      error instanceof Error ? error.message : 'model response was unusable',
      200,
      attempts,
      usage,
      billingAmbiguous
    );
  }
  return {
    text,
    ...usage,
    attempts,
    billingAmbiguous,
  };
}

/** Call the resolved engine. The caller supplies the API key for the resolved
 * provider (workspace key for BYOK, platform key for hosted, empty for
 * ollama). */
export function callModel(
  engine: ResolvedEngine,
  apiKey: string,
  call: ModelCall
): Promise<ModelResult> {
  const provider = getProvider(engine.provider);
  if (!provider) throw new Error(`unknown engine provider: ${engine.provider}`);
  if (
    provider.requiresKey &&
    !apiKey &&
    !(provider.id === 'compatible' && engine.mode === 'local')
  ) {
    throw new Error(`no ${provider.label} API key configured; add one in Settings`);
  }
  if (!engine.model) throw new Error('no model configured for this task');
  const maxTokens = call.maxTokens ?? 4000;
  const baseUrl = resolveEngineEndpoint(engine, provider);

  const request =
    provider.wire === 'anthropic'
      ? callAnthropic(baseUrl, apiKey, engine.model, engine.effort, call, maxTokens)
      : callOpenAiCompatible(
          engine.provider,
          baseUrl,
          apiKey,
          engine.model,
          engine.effort,
          call,
          maxTokens,
          engine.mode === 'local' ? LOCAL_MODEL_TIMEOUT_MS : MODEL_TIMEOUT_MS
        );
  return request.catch((error: unknown) => {
    if (error instanceof TypeError) {
      throw new Error(`could not reach ${provider.label} (${engine.model}) at ${baseUrl}`);
    }
    throw error;
  });
}

/** Extracts the first JSON object from model text, tolerating fences. */
export function parseModelJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('model returned no JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
