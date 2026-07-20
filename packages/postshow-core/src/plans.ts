// Plans and quotas. Hosted tiers are priced in legible units - sessions
// watched and deep dives - never tokens. Quotas are sized from measured
// per-unit model cost at catalog list prices (2026-07-20):
//
//   narration sweep (Haiku 4.5, ~12K in / ~3K out) ......... ~$0.027 a run,
//     covering up to 40 session samples, so under $0.001 a session watched
//   investigation (Sonnet 5, ~12K in / ~3K out) ............ ~$0.08 a run
//   deep dive (Opus 4.8, ~25K in / ~8K out) ................ ~$0.33 a run
//     (Fable 5 worst case ~$0.65 a run)
//
// Solo at $99 with 3,000 sessions + 20 deep dives lands near $15/mo of model
// cost fully used (~85% gross margin); Team at $249 with 12,000 sessions +
// 60 deep dives lands near $45/mo (~82%). Both clear the 3-4x markup target
// with headroom for retries and frontier-model overrides.

export type PlanId = 'free' | 'solo' | 'team' | 'enterprise';

export interface PlanQuota {
  /** Session samples the hosted watcher narrates per month. */
  sessionsWatched: number;
  /** Hosted deep-dive runs per month. */
  deepDives: number;
  /** Hosted investigation/drafting runs per month. */
  investigations: number;
}

/** Per-workspace overrides, set by us for enterprise deals (custom quotas,
 * custom seat counts, metered usage billing). Null fields inherit the plan. */
export interface EntitlementOverrides {
  sessionsWatched: number | null;
  deepDives: number | null;
  investigations: number | null;
  seats: number | null;
  /** Metered workspaces never degrade: usage past the quota is recorded and
   * billed per unit instead. Enterprise only. */
  metered: boolean;
}

export interface Plan {
  id: PlanId;
  label: string;
  priceUsdMonthly: number | null;
  /** Workspace members allowed. Seats are a paid feature: free stays solo. */
  seats: number;
  /** Whether the cloud runtime schedules this workspace's jobs. Free runs
   * locally (CLI/desktop) or on demand from the web app. */
  cloudScheduling: boolean;
  /** Whether Postshow's hosted model keys are available. */
  hostedModels: boolean;
  quota: PlanQuota;
  blurb: string;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    priceUsdMonthly: 0,
    cloudScheduling: false,
    hostedModels: false,
    seats: 1,
    quota: { sessionsWatched: 0, deepDives: 0, investigations: 0 },
    blurb:
      'The full product with your own keys or local models. Desktop, CLI, MCP, workspace sync, and on-demand runs. Free forever.',
  },
  solo: {
    id: 'solo',
    label: 'Solo',
    priceUsdMonthly: 99,
    cloudScheduling: true,
    hostedModels: true,
    seats: 1,
    quota: { sessionsWatched: 3000, deepDives: 20, investigations: 120 },
    blurb: 'Always-on cloud runtime with hosted models. The agent works while your laptop sleeps.',
  },
  team: {
    id: 'team',
    label: 'Team',
    priceUsdMonthly: 249,
    cloudScheduling: true,
    hostedModels: true,
    seats: 5,
    quota: { sessionsWatched: 12000, deepDives: 60, investigations: 400 },
    blurb: 'Higher volumes, hourly sweeps, and five seats for the go-to-market team.',
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    priceUsdMonthly: null,
    cloudScheduling: true,
    hostedModels: true,
    seats: 25,
    quota: { sessionsWatched: 100000, deepDives: 500, investigations: 4000 },
    blurb:
      'Custom quotas and seats, usage billed on your terms, and priority support for self-hosted or local-only deployment.',
  },
};

/** Legacy plan values stored before tiered hosting shipped. */
export function normalizePlanId(raw: string): PlanId {
  if (raw === 'solo' || raw === 'team' || raw === 'enterprise') return raw;
  if (raw === 'hosted') return 'solo';
  return 'free';
}

export interface UsageTotals {
  sessionsWatched: number;
  deepDives: number;
  investigations: number;
}

/** The quota and seat count a workspace actually has: enterprise overrides
 * win field by field, everything else inherits the plan. */
export function effectiveQuota(
  plan: Plan,
  overrides: EntitlementOverrides | null
): PlanQuota & { seats: number; metered: boolean } {
  return {
    sessionsWatched: overrides?.sessionsWatched ?? plan.quota.sessionsWatched,
    deepDives: overrides?.deepDives ?? plan.quota.deepDives,
    investigations: overrides?.investigations ?? plan.quota.investigations,
    seats: overrides?.seats ?? plan.seats,
    metered: overrides?.metered ?? false,
  };
}

export type QuotaState = 'ok' | 'degraded';

/** Hosted runs never hard-fail on quota; they degrade. Over the session
 * budget, sweeps thin their sampling; over the deep-dive budget, deep dives
 * wait for the next cycle. The caller decides what "degraded" means per task
 * class - this just answers whether the budget for a class is spent. */
export function quotaState(plan: Plan, usage: UsageTotals, taskUnits: keyof PlanQuota): QuotaState {
  return usage[taskUnits] >= plan.quota[taskUnits] ? 'degraded' : 'ok';
}

/** Same check against the effective (override-aware) quota. Metered
 * workspaces never degrade: past-quota units are billed, not throttled. */
export function effectiveQuotaState(
  plan: Plan,
  overrides: EntitlementOverrides | null,
  usage: UsageTotals,
  taskUnits: keyof PlanQuota
): QuotaState {
  const effective = effectiveQuota(plan, overrides);
  if (effective.metered) return 'ok';
  return usage[taskUnits] >= effective[taskUnits] ? 'degraded' : 'ok';
}
