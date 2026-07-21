// The engine catalog: every provider Postshow can drive, with the models we
// curate per provider and their list prices. Prices are USD per million
// tokens, verified against each provider's official pricing page on
// 2026-07-20. They exist for cost accounting and quota sizing, not billing
// customers by token - hosted plans are priced in sessions watched and deep
// dives, never tokens.

export type EngineMode = 'hosted' | 'byok' | 'local';

export type EngineProviderId =
  | 'anthropic'
  | 'openai'
  | 'moonshot'
  | 'zhipu'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'compatible'
  | 'ollama';

export type ModelTier = 'frontier' | 'standard' | 'fast';

/** Postshow's normalized effort ladder. Each provider maps these onto its own
 * reasoning control (or ignores them) in the engine. */
export type EffortLevel = 'minimal' | 'low' | 'medium' | 'high' | 'max';

export const EFFORT_LEVELS: EffortLevel[] = ['minimal', 'low', 'medium', 'high', 'max'];

/** How a provider speaks on the wire. */
export type WireFormat = 'anthropic' | 'openai-chat';

export interface CatalogModel {
  id: string;
  label: string;
  tier: ModelTier;
  /** USD per 1M input tokens (list price, 2026-07-20). */
  inputPerMtokUsd: number;
  /** USD per 1M output tokens (list price, 2026-07-20). */
  outputPerMtokUsd: number;
  contextWindow: number;
  /** False when Postshow must not use this model with a platform-owned key.
   * BYOK users may still select it after accepting the provider's terms. */
  hostedEligible?: boolean;
}

export interface CatalogProvider {
  id: EngineProviderId;
  label: string;
  wire: WireFormat;
  /** Default API base URL. `compatible` and `ollama` are overridable per workspace. */
  baseUrl: string;
  /** True when Postshow's hosted engine can carry this provider's bill. */
  hosted: boolean;
  /** True when the provider needs an API key (ollama does not). */
  requiresKey: boolean;
  models: CatalogModel[];
}

export const CATALOG: CatalogProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    hosted: true,
    requiresKey: true,
    models: [
      {
        id: 'claude-opus-4-8',
        label: 'Claude Opus 4.8',
        tier: 'frontier',
        inputPerMtokUsd: 5,
        outputPerMtokUsd: 25,
        contextWindow: 1_000_000,
        hostedEligible: true,
      },
      {
        id: 'claude-fable-5',
        label: 'Claude Fable 5 (BYOK only)',
        tier: 'frontier',
        inputPerMtokUsd: 10,
        outputPerMtokUsd: 50,
        contextWindow: 1_000_000,
        // Anthropic requires 30-day retention for Fable and does not make it
        // available under ZDR arrangements. Never select it for hosted calls.
        hostedEligible: false,
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        tier: 'standard',
        inputPerMtokUsd: 3,
        outputPerMtokUsd: 15,
        contextWindow: 1_000_000,
        hostedEligible: true,
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        tier: 'fast',
        inputPerMtokUsd: 1,
        outputPerMtokUsd: 5,
        contextWindow: 200_000,
        hostedEligible: true,
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    hosted: true,
    requiresKey: true,
    models: [
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        tier: 'frontier',
        inputPerMtokUsd: 5,
        outputPerMtokUsd: 30,
        contextWindow: 1_050_000,
        hostedEligible: true,
      },
      {
        id: 'gpt-5.6-terra',
        label: 'GPT-5.6 Terra',
        tier: 'frontier',
        inputPerMtokUsd: 2.5,
        outputPerMtokUsd: 15,
        contextWindow: 1_050_000,
        hostedEligible: true,
      },
      {
        id: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna',
        tier: 'standard',
        inputPerMtokUsd: 1,
        outputPerMtokUsd: 6,
        contextWindow: 1_050_000,
        hostedEligible: true,
      },
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        tier: 'standard',
        inputPerMtokUsd: 2.5,
        outputPerMtokUsd: 15,
        contextWindow: 1_050_000,
        hostedEligible: true,
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4 mini',
        tier: 'fast',
        inputPerMtokUsd: 0.75,
        outputPerMtokUsd: 4.5,
        contextWindow: 400_000,
        hostedEligible: true,
      },
      {
        id: 'gpt-5.4-nano',
        label: 'GPT-5.4 nano',
        tier: 'fast',
        inputPerMtokUsd: 0.2,
        outputPerMtokUsd: 1.25,
        contextWindow: 400_000,
        hostedEligible: true,
      },
    ],
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    wire: 'openai-chat',
    baseUrl: 'https://api.moonshot.ai/v1',
    hosted: false,
    requiresKey: true,
    models: [
      {
        id: 'kimi-k3',
        label: 'Kimi K3',
        tier: 'frontier',
        inputPerMtokUsd: 3,
        outputPerMtokUsd: 15,
        contextWindow: 1_048_576,
      },
      {
        id: 'kimi-k2.6',
        label: 'Kimi K2.6',
        tier: 'standard',
        inputPerMtokUsd: 0.95,
        outputPerMtokUsd: 4,
        contextWindow: 262_144,
      },
      {
        id: 'kimi-k2.5',
        label: 'Kimi K2.5',
        tier: 'fast',
        inputPerMtokUsd: 0.6,
        outputPerMtokUsd: 3,
        contextWindow: 262_144,
      },
    ],
  },
  {
    id: 'zhipu',
    label: 'Z.ai (GLM)',
    wire: 'openai-chat',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    hosted: false,
    requiresKey: true,
    models: [
      {
        id: 'glm-5.1',
        label: 'GLM-5.1',
        tier: 'frontier',
        inputPerMtokUsd: 1.4,
        outputPerMtokUsd: 4.4,
        contextWindow: 1_000_000,
      },
      {
        id: 'glm-5',
        label: 'GLM-5',
        tier: 'standard',
        inputPerMtokUsd: 1,
        outputPerMtokUsd: 3.2,
        contextWindow: 200_000,
      },
      {
        id: 'glm-4.7',
        label: 'GLM-4.7',
        tier: 'standard',
        inputPerMtokUsd: 0.6,
        outputPerMtokUsd: 2.2,
        contextWindow: 200_000,
      },
      {
        id: 'glm-4.7-flashx',
        label: 'GLM-4.7 FlashX',
        tier: 'fast',
        inputPerMtokUsd: 0.07,
        outputPerMtokUsd: 0.4,
        contextWindow: 200_000,
      },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    wire: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    hosted: false,
    requiresKey: true,
    models: [
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        tier: 'frontier',
        inputPerMtokUsd: 0.435,
        outputPerMtokUsd: 0.87,
        contextWindow: 1_000_000,
      },
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        tier: 'fast',
        inputPerMtokUsd: 0.14,
        outputPerMtokUsd: 0.28,
        contextWindow: 1_000_000,
      },
    ],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    wire: 'openai-chat',
    baseUrl: 'https://api.x.ai/v1',
    hosted: false,
    requiresKey: true,
    models: [
      {
        id: 'grok-4.5',
        label: 'Grok 4.5',
        tier: 'frontier',
        inputPerMtokUsd: 2,
        outputPerMtokUsd: 6,
        contextWindow: 500_000,
      },
      {
        id: 'grok-4.3',
        label: 'Grok 4.3',
        tier: 'standard',
        inputPerMtokUsd: 1.25,
        outputPerMtokUsd: 2.5,
        contextWindow: 1_000_000,
      },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    wire: 'openai-chat',
    baseUrl: 'https://api.mistral.ai/v1',
    hosted: false,
    requiresKey: true,
    models: [
      {
        id: 'mistral-large-2512',
        label: 'Mistral Large 3',
        tier: 'standard',
        inputPerMtokUsd: 0.5,
        outputPerMtokUsd: 1.5,
        contextWindow: 262_144,
      },
      {
        id: 'mistral-small-2603',
        label: 'Mistral Small 4',
        tier: 'fast',
        inputPerMtokUsd: 0.15,
        outputPerMtokUsd: 0.6,
        contextWindow: 262_144,
      },
    ],
  },
  {
    id: 'compatible',
    label: 'OpenAI-compatible',
    wire: 'openai-chat',
    baseUrl: '',
    hosted: false,
    requiresKey: true,
    models: [],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    wire: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    hosted: false,
    requiresKey: false,
    models: [],
  },
];

export function getProvider(id: string): CatalogProvider | null {
  return CATALOG.find((p) => p.id === id) ?? null;
}

export function getModel(providerId: string, modelId: string): CatalogModel | null {
  const provider = getProvider(providerId);
  return provider?.models.find((m) => m.id === modelId) ?? null;
}

/** Providers whose bill the hosted engine can carry. */
export function hostedProviders(): CatalogProvider[] {
  return CATALOG.filter((p) => p.hosted);
}

export function isHostedModel(providerId: string, modelId: string): boolean {
  const provider = getProvider(providerId);
  if (!provider?.hosted) return false;
  const model = getModel(providerId, modelId);
  // Hosted billing and retention are fail-closed. A newly added model is BYOK
  // until its exact economics and data contract are explicitly reviewed.
  return Boolean(model?.hostedEligible === true);
}

/** The provider's default model for a tier, falling back down the ladder
 * (frontier -> standard -> fast) and then up it, so every provider with any
 * models resolves. */
export function tierDefault(providerId: string, tier: ModelTier): CatalogModel | null {
  const provider = getProvider(providerId);
  if (!provider || provider.models.length === 0) return null;
  const ladder: ModelTier[] =
    tier === 'frontier'
      ? ['frontier', 'standard', 'fast']
      : tier === 'standard'
        ? ['standard', 'frontier', 'fast']
        : ['fast', 'standard', 'frontier'];
  for (const t of ladder) {
    const found = provider.models.find((m) => m.tier === t);
    if (found) return found;
  }
  return provider.models[0] ?? null;
}

/** Cost of one model call in USD micros (1e-6 USD), from catalog list prices.
 * Unknown models (compatible, ollama, drifted ids) cost 0 - we never invent
 * a price for a model we cannot identify. */
export function estimateCostUsdMicros(
  providerId: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const model = getModel(providerId, modelId);
  if (!model) return 0;
  const usd =
    (inputTokens / 1_000_000) * model.inputPerMtokUsd +
    (outputTokens / 1_000_000) * model.outputPerMtokUsd;
  return Math.round(usd * 1_000_000);
}
