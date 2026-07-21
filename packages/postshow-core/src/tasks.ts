// Task classes: every model call Postshow makes on a user's behalf belongs to
// one class, and each class resolves its own {mode, provider, model, effort}.
// Users can override any field per class; unset fields fall back to the
// workspace's default engine, then to the catalog's tier default.

import {
  type EffortLevel,
  type EngineMode,
  type EngineProviderId,
  type ModelTier,
  getModel,
  getProvider,
  isHostedModel,
  tierDefault,
} from './catalog';

export type TaskClass = 'narration' | 'investigation' | 'deep_dive' | 'drafting';

export const TASK_CLASSES: TaskClass[] = ['narration', 'investigation', 'deep_dive', 'drafting'];

export const TASK_CLASS_INFO: Record<
  TaskClass,
  { label: string; hint: string; tier: ModelTier; effort: EffortLevel }
> = {
  narration: {
    label: 'Session watcher',
    hint: 'Narrates a bounded session sample on each sweep, so it defaults to the fast tier.',
    tier: 'fast',
    effort: 'low',
  },
  investigation: {
    label: 'Recon agent',
    hint: 'Standing investigations and custom questions on a schedule.',
    tier: 'standard',
    effort: 'medium',
  },
  deep_dive: {
    label: 'Deep dive agent',
    hint: 'The weekly why-did-this-move analysis. Defaults to the frontier tier.',
    tier: 'frontier',
    effort: 'high',
  },
  drafting: {
    label: 'Draft writer',
    hint: 'Rewrites and refines outreach drafts on request.',
    tier: 'standard',
    effort: 'medium',
  },
};

/** A per-task override as stored in engine settings (all fields optional). */
export interface TaskPref {
  mode?: EngineMode;
  provider?: EngineProviderId;
  model?: string;
  effort?: EffortLevel;
}

/** The workspace default engine row (postshow_engine_settings). */
export interface EngineDefaults {
  mode: EngineMode;
  provider: EngineProviderId;
  model: string;
  base_url: string;
}

/** A fully resolved engine choice for one call. */
export interface ResolvedEngine {
  taskClass: TaskClass;
  mode: EngineMode;
  provider: EngineProviderId;
  model: string;
  effort: EffortLevel;
  baseUrl: string;
}

const HOSTED_DEFAULT_PROVIDER: EngineProviderId = 'anthropic';

/** Resolve the engine for one task class. Precedence per field: the task
 * pref, then the workspace default engine, then the catalog tier default for
 * the resolved provider. */
export function resolveTaskEngine(
  taskClass: TaskClass,
  defaults: EngineDefaults | null,
  prefs: Partial<Record<TaskClass, TaskPref>> | null
): ResolvedEngine {
  const info = TASK_CLASS_INFO[taskClass];
  const pref = prefs?.[taskClass] ?? {};
  const mode = pref.mode ?? defaults?.mode ?? 'byok';
  const requestedProvider =
    pref.provider ?? defaults?.provider ?? (mode === 'local' ? 'ollama' : 'anthropic');
  let provider = requestedProvider;
  if (!getProvider(provider)) provider = 'anthropic';
  if (mode === 'hosted' && !getProvider(provider)?.hosted) provider = HOSTED_DEFAULT_PROVIDER;
  if (mode === 'local' && provider !== 'ollama' && provider !== 'compatible') provider = 'ollama';

  // A mode/provider coercion must not carry a curated cloud model into a
  // local or hosted engine. Only an override explicitly paired with the final
  // provider may supply a model across that boundary.
  let model =
    provider === requestedProvider || pref.provider === provider ? (pref.model ?? '') : '';
  if (mode === 'local' && pref.provider === undefined && defaults?.provider !== provider)
    model = '';
  if (!model && pref.provider === undefined && defaults?.provider === provider && defaults?.model) {
    // Only inherit the default model when the provider was inherited too; a
    // per-task provider switch should not drag along another provider's model.
    model = defaults.model;
  }
  if (model && getProvider(provider)!.models.length > 0 && !getModel(provider, model)) {
    // Unknown model for a curated provider: fall back to the tier default so
    // a stale saved id cannot break runs after a catalog refresh.
    model = '';
  }
  if (!model) model = tierDefault(provider, info.tier)?.id ?? '';
  const allowedHostedTiers: ModelTier[] =
    info.tier === 'fast'
      ? ['fast']
      : info.tier === 'standard'
        ? ['fast', 'standard']
        : ['fast', 'standard', 'frontier'];
  if (
    mode === 'hosted' &&
    model &&
    (!isHostedModel(provider, model) ||
      !allowedHostedTiers.includes(getModel(provider, model)?.tier ?? 'frontier'))
  ) {
    model =
      getProvider(provider)?.models.find(
        (candidate) => candidate.tier === info.tier && candidate.hostedEligible === true
      )?.id ??
      getProvider(provider)?.models.find(
        (candidate) =>
          candidate.hostedEligible === true && allowedHostedTiers.includes(candidate.tier)
      )?.id ??
      '';
  }

  // Curated providers are permanently bound to their catalog origins. Custom
  // endpoints are workspace-wide so one provider credential can never be
  // rebound to a different target by a per-task override.
  const customEndpoint = provider === 'compatible' || provider === 'ollama';
  const inheritedBaseUrl = defaults?.provider === provider ? defaults.base_url : '';
  const baseUrl = customEndpoint ? inheritedBaseUrl : '';
  return {
    taskClass,
    mode,
    provider,
    model,
    effort: pref.effort ?? info.effort,
    baseUrl,
  };
}

/** Map a work-plan job kind onto the task class that runs it. */
export function taskClassForJobKind(kind: string): TaskClass {
  if (kind === 'deep_dive') return 'deep_dive';
  if (kind === 'session_sweep') return 'narration';
  return 'investigation';
}
