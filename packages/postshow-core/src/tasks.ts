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
    hint: 'Narrates every session sweep. Runs constantly, so it defaults to the fast tier.',
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
  base_url?: string;
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
  let provider =
    pref.provider ??
    (mode === 'hosted' ? HOSTED_DEFAULT_PROVIDER : (defaults?.provider ?? 'anthropic'));
  if (!getProvider(provider)) provider = 'anthropic';
  if (mode === 'hosted' && !getProvider(provider)?.hosted) provider = HOSTED_DEFAULT_PROVIDER;

  let model = pref.model ?? '';
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

  const baseUrl = pref.base_url ?? defaults?.base_url ?? '';
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
