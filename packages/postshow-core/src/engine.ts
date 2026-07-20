// The multi-provider engine. One entry point (callModel) drives every
// provider in the catalog with the caller's resolved {provider, model,
// effort}. Two wire formats cover everything: Anthropic's native messages
// API, and the OpenAI chat-completions shape that OpenAI, Moonshot, Z.ai,
// DeepSeek, xAI, Mistral, Ollama, and custom compatible endpoints all speak.
// Every call returns token usage so the caller can meter it.

import { type EffortLevel, getProvider } from './catalog';
import type { ResolvedEngine } from './tasks';

export interface ModelCall {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
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
      // GLM takes thinking {type} plus the full reasoning_effort ladder.
      if (effort === 'minimal') return { thinking: { type: 'disabled' } };
      const effortMap: Record<EffortLevel, string> = {
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        max: 'max',
      };
      return { thinking: { type: 'enabled' }, reasoning_effort: effortMap[effort] };
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
      // Small/Medium take reasoning_effort none|high.
      return { reasoning_effort: effort === 'minimal' || effort === 'low' ? 'none' : 'high' };
    }
    default:
      // ollama, compatible: no portable reasoning control.
      return {};
  }
}

function trimBase(url: string): string {
  return url.replace(/\/$/, '');
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return `model call failed (${response.status}): ${body.slice(0, 300)}`;
}

async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  effort: EffortLevel,
  call: ModelCall,
  maxTokens: number
): Promise<ModelResult> {
  const response = await fetch(`${trimBase(baseUrl || 'https://api.anthropic.com')}/v1/messages`, {
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
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  const text = ((data.content ?? []) as { type: string; text?: string }[])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  return {
    text,
    inputTokens: Number(data.usage?.input_tokens ?? 0),
    outputTokens: Number(data.usage?.output_tokens ?? 0),
  };
}

async function callOpenAiCompatible(
  provider: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  effort: EffortLevel,
  call: ModelCall,
  maxTokens: number
): Promise<ModelResult> {
  const response = await fetch(`${trimBase(baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: call.system },
        { role: 'user', content: call.prompt },
      ],
      ...reasoningParams(provider, model, effort),
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  return {
    text: String(data.choices?.[0]?.message?.content ?? ''),
    inputTokens: Number(data.usage?.prompt_tokens ?? 0),
    outputTokens: Number(data.usage?.completion_tokens ?? 0),
  };
}

/** Call the resolved engine. The caller supplies the API key for the resolved
 * provider (workspace key for BYOK, platform key for hosted, empty for
 * ollama). */
export async function callModel(
  engine: ResolvedEngine,
  apiKey: string,
  call: ModelCall
): Promise<ModelResult> {
  const provider = getProvider(engine.provider);
  if (!provider) throw new Error(`unknown engine provider: ${engine.provider}`);
  if (provider.requiresKey && !apiKey) {
    throw new Error(`no ${provider.label} API key configured; add one in Settings`);
  }
  if (!engine.model) throw new Error('no model configured for this task');
  const maxTokens = call.maxTokens ?? 4000;
  const baseUrl = engine.baseUrl || provider.baseUrl;
  if (!baseUrl) throw new Error('this engine needs a base URL; set one in Settings');

  if (provider.wire === 'anthropic') {
    return callAnthropic(baseUrl, apiKey, engine.model, engine.effort, call, maxTokens);
  }
  return callOpenAiCompatible(
    engine.provider,
    baseUrl,
    apiKey,
    engine.model,
    engine.effort,
    call,
    maxTokens
  );
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
