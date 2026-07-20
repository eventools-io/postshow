import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CATALOG,
  EFFORT_LEVELS,
  PLANS,
  TASK_CLASSES,
  TASK_CLASS_INFO,
  effectiveQuota,
  getProvider,
  normalizePlanId,
  resolveTaskEngine,
  type EngineDefaults,
  type EntitlementOverrides,
} from '@eventools/postshow-core';
import { useWorkspace } from '@/state/WorkspaceContext';
import {
  addMember,
  createApiToken,
  fetchApiTokens,
  fetchEngine,
  fetchEntitlements,
  fetchKeyProviders,
  fetchMembers,
  fetchUsageSummary,
  removeMember,
  revokeApiToken,
  setAgentRules,
  setEngine,
  setEngineKey,
  setTaskPrefs,
  startCheckout,
} from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { PageHeader, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import type {
  ApiToken,
  WorkspaceMember,
  EngineEffort,
  EngineProvider,
  EngineSettings,
  EngineTaskClass,
  EngineTaskPref,
  UsageSummaryRow,
} from '@/lib/types';

const MODES: { value: EngineSettings['mode']; label: string; blurb: string }[] = [
  {
    value: 'byok',
    label: 'Your keys',
    blurb: 'Bring keys for any provider in the catalog. Free forever.',
  },
  {
    value: 'hosted',
    label: 'Hosted',
    blurb: 'We run the models and carry the bill. Solo and Team plans.',
  },
  {
    value: 'local',
    label: 'Local',
    blurb: 'Point at an Ollama-compatible endpoint you run yourself.',
  },
];

const KEY_PROVIDERS = CATALOG.filter((p) => p.requiresKey && p.id !== 'compatible');

function providerModels(providerId: string) {
  return getProvider(providerId)?.models ?? [];
}

function EngineSection({
  workspaceId,
  engine,
  reload,
}: {
  workspaceId: string;
  engine: EngineSettings | null;
  reload: () => void;
}) {
  const [mode, setMode] = useState<EngineSettings['mode']>('byok');
  const [provider, setProvider] = useState<EngineProvider>('anthropic');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!engine) return;
    setMode(engine.mode);
    setProvider(engine.provider);
    setModel(engine.model);
    setBaseUrl(engine.base_url);
  }, [engine]);

  const models = providerModels(provider);
  const needsBaseUrl = provider === 'compatible' || provider === 'ollama';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await setEngine({ workspaceId, mode, provider, model, baseUrl, apiKey: null });
      track('engine_saved', { mode, provider });
      setSaved(true);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save engine settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Engine">
      <form onSubmit={handleSubmit} className="ps-card flex flex-col gap-4 p-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              aria-pressed={mode === option.value}
              className={[
                'flex flex-col items-start gap-1 rounded-sm border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                mode === option.value
                  ? 'border-signal bg-night-2'
                  : 'border-night-4 hover:bg-night-2',
              ].join(' ')}
            >
              <span className="font-public-sans text-[14px] font-medium text-night-fg">
                {option.label}
              </span>
              <span className="font-public-sans text-[12px] leading-[1.4] text-night-fg-2">
                {option.blurb}
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="ps-label">Default provider</span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as EngineProvider);
                setModel('');
              }}
              className="ps-input"
            >
              {CATALOG.filter((p) => (mode === 'hosted' ? p.hosted : true)).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ps-label">Default model</span>
            {models.length ? (
              <select value={model} onChange={(e) => setModel(e.target.value)} className="ps-input">
                <option value="">per-task default</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="ps-input"
                placeholder={provider === 'ollama' ? 'llama3.3' : 'model id'}
              />
            )}
          </label>
        </div>
        {needsBaseUrl && (
          <label className="flex flex-col gap-1">
            <span className="ps-label">Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="ps-input"
              placeholder="http://localhost:11434/v1"
            />
          </label>
        )}

        {error && <ErrorRow message={error} />}
        {saved && (
          <p className="m-0 font-public-mono text-[11px] uppercase tracking-[0.12em] text-signal">
            saved
          </p>
        )}
        <button type="submit" disabled={busy} className="ps-btn-primary w-fit">
          {busy ? 'Saving…' : 'Save engine'}
        </button>
      </form>
    </Section>
  );
}

function TaskMatrixSection({
  workspaceId,
  engine,
  reload,
}: {
  workspaceId: string;
  engine: EngineSettings | null;
  reload: () => void;
}) {
  const [prefs, setPrefs] = useState<Partial<Record<EngineTaskClass, EngineTaskPref>>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setPrefs(engine?.task_prefs ?? {});
  }, [engine]);

  const defaults: EngineDefaults | null = engine
    ? {
        mode: engine.mode,
        provider: engine.provider,
        model: engine.model,
        base_url: engine.base_url,
      }
    : null;

  function updatePref(task: EngineTaskClass, patch: Partial<EngineTaskPref>) {
    setPrefs((current) => {
      const next = { ...current };
      const merged: EngineTaskPref = { ...next[task], ...patch };
      for (const key of Object.keys(merged) as (keyof EngineTaskPref)[]) {
        if (merged[key] === undefined || merged[key] === '') delete merged[key];
      }
      if (Object.keys(merged).length === 0) delete next[task];
      else next[task] = merged;
      return next;
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      await setTaskPrefs(workspaceId, prefs);
      track('task_prefs_saved', { overridden: Object.keys(prefs).length });
      setStatus('saved');
      reload();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not save task settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Model per task">
      <div className="ps-card flex flex-col gap-4 p-5">
        <p className="m-0 max-w-[64ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          Each kind of work resolves its own model and effort. Anything left on inherit follows the
          default engine, then the provider&apos;s tier default: fast for the watcher, standard for
          recon, frontier for deep dives.
        </p>
        <div className="flex flex-col gap-3">
          {TASK_CLASSES.map((task) => {
            const info = TASK_CLASS_INFO[task];
            const pref = prefs[task] ?? {};
            const resolved = resolveTaskEngine(task, defaults, prefs);
            const models = providerModels(pref.provider ?? resolved.provider);
            return (
              <div
                key={task}
                className="grid gap-2 rounded-sm border border-night-4 p-3 sm:grid-cols-[1.2fr_1fr_1fr_0.7fr]"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-public-sans text-[13px] font-medium text-night-fg">
                    {info.label}
                  </span>
                  <span className="font-public-sans text-[11px] leading-[1.4] text-night-fg-3">
                    {info.hint}
                  </span>
                  <span className="mt-1 font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                    runs {resolved.mode}/{resolved.provider}/{resolved.model || ' - '} ·{' '}
                    {resolved.effort}
                  </span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="ps-label">Provider</span>
                  <select
                    value={pref.provider ?? ''}
                    onChange={(e) =>
                      updatePref(task, {
                        provider: (e.target.value || undefined) as EngineProvider | undefined,
                        model: undefined,
                      })
                    }
                    className="ps-input"
                  >
                    <option value="">inherit</option>
                    {CATALOG.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="ps-label">Model</span>
                  {models.length ? (
                    <select
                      value={pref.model ?? ''}
                      onChange={(e) => updatePref(task, { model: e.target.value || undefined })}
                      className="ps-input"
                    >
                      <option value="">tier default</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={pref.model ?? ''}
                      onChange={(e) => updatePref(task, { model: e.target.value || undefined })}
                      className="ps-input"
                      placeholder="model id"
                    />
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="ps-label">Effort</span>
                  <select
                    value={pref.effort ?? ''}
                    onChange={(e) =>
                      updatePref(task, {
                        effort: (e.target.value || undefined) as EngineEffort | undefined,
                      })
                    }
                    className="ps-input"
                  >
                    <option value="">{info.effort} (default)</option>
                    {EFFORT_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="ps-btn-primary w-fit"
          >
            {busy ? 'Saving…' : 'Save task settings'}
          </button>
          {status && (
            <span
              className={
                status === 'saved'
                  ? 'font-public-mono text-[11px] uppercase tracking-[0.12em] text-signal'
                  : 'font-public-sans text-[13px] text-bad'
              }
            >
              {status}
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

function KeysSection({ workspaceId }: { workspaceId: string }) {
  const fetcher = useCallback(() => fetchKeyProviders(workspaceId), [workspaceId]);
  const { data: configured, reload } = usePageData(fetcher);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyProvider, setBusyProvider] = useState('');
  const [error, setError] = useState('');

  async function saveKey(provider: EngineProvider) {
    const key = (drafts[provider] ?? '').trim();
    if (!key || busyProvider) return;
    setBusyProvider(provider);
    setError('');
    try {
      await setEngineKey(workspaceId, provider, key);
      track('engine_key_saved', { provider });
      setDrafts((d) => ({ ...d, [provider]: '' }));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save key.');
    } finally {
      setBusyProvider('');
    }
  }

  async function clearKey(provider: EngineProvider) {
    if (busyProvider) return;
    setBusyProvider(provider);
    setError('');
    try {
      await setEngineKey(workspaceId, provider, '');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove key.');
    } finally {
      setBusyProvider('');
    }
  }

  return (
    <Section title="Provider keys">
      <div className="ps-card flex flex-col gap-3 p-5">
        <p className="m-0 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          Keys are write-only: stored server-side, never displayed again. Each provider keeps its
          own key, so recon can run on a cheap provider while deep dives use a frontier one.
        </p>
        <div className="flex flex-col gap-2">
          {KEY_PROVIDERS.map((provider) => {
            const hasKey = (configured ?? []).includes(provider.id);
            return (
              <div
                key={provider.id}
                className="grid items-center gap-2 sm:grid-cols-[160px_1fr_auto]"
              >
                <span className="font-public-sans text-[13px] text-night-fg">
                  {provider.label}
                  {hasKey && (
                    <span className="ml-2 font-public-mono text-[10px] uppercase tracking-[0.1em] text-signal">
                      key saved
                    </span>
                  )}
                </span>
                <input
                  type="password"
                  value={drafts[provider.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [provider.id]: e.target.value }))}
                  className="ps-input"
                  placeholder={hasKey ? 'replace key' : 'add key'}
                  autoComplete="off"
                  aria-label={`${provider.label} API key`}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveKey(provider.id as EngineProvider)}
                    disabled={busyProvider !== '' || !(drafts[provider.id] ?? '').trim()}
                    className="ps-btn-primary"
                  >
                    Save
                  </button>
                  {hasKey && (
                    <button
                      type="button"
                      onClick={() => void clearKey(provider.id as EngineProvider)}
                      disabled={busyProvider !== ''}
                      className="ps-btn-ghost"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {error && <ErrorRow message={error} />}
      </div>
    </Section>
  );
}

function UsageMeter({ label, used, quota }: { label: string; used: number; quota: number }) {
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="font-public-sans text-[13px] text-night-fg">{label}</span>
        <span className="font-public-mono text-[11px] text-night-fg-2">
          {used.toLocaleString()} / {quota.toLocaleString()}
        </span>
      </div>
      <div className="h-[6px] w-full overflow-hidden rounded-full bg-night-3" aria-hidden>
        <div
          className={percent >= 100 ? 'h-full bg-warn' : 'h-full bg-signal'}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function PlanSection({ workspaceId, planId }: { workspaceId: string; planId: string }) {
  const fetcher = useCallback(() => fetchUsageSummary(workspaceId), [workspaceId]);
  const { data: usage } = usePageData(fetcher);
  const entitlementsFetcher = useCallback(() => fetchEntitlements(workspaceId), [workspaceId]);
  const { data: entitlementRow } = usePageData(entitlementsFetcher);
  const [busyTier, setBusyTier] = useState('');
  const [error, setError] = useState('');

  const plan = PLANS[normalizePlanId(planId)];
  const overrides: EntitlementOverrides | null = entitlementRow
    ? {
        sessionsWatched: entitlementRow.sessions_watched,
        deepDives: entitlementRow.deep_dives,
        investigations: entitlementRow.investigations,
        seats: entitlementRow.seats,
        metered: entitlementRow.metered,
      }
    : null;
  const quota = effectiveQuota(plan, overrides);
  const totals = useMemo(() => {
    const rows = usage ?? [];
    const sum = (task: string) =>
      rows.filter((r: UsageSummaryRow) => r.task_class === task).reduce((a, r) => a + r.units, 0);
    return {
      sessions: sum('narration'),
      deepDives: sum('deep_dive'),
      investigations: sum('investigation') + sum('drafting'),
      costUsd: rows.reduce((a, r) => a + r.cost_usd_micros, 0) / 1_000_000,
    };
  }, [usage]);

  async function upgrade(tier: 'solo' | 'team') {
    if (busyTier) return;
    setBusyTier(tier);
    setError('');
    try {
      const result = await startCheckout(workspaceId, tier);
      if (result.ok && result.url) {
        window.location.href = result.url;
        return;
      }
      setError(result.detail ?? 'Checkout is not open yet.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed.');
    } finally {
      setBusyTier('');
    }
  }

  return (
    <Section title="Plan and usage">
      <div className="ps-card flex flex-col gap-4 p-5">
        <div className="flex items-baseline justify-between">
          <p className="m-0 font-public-sans text-[14px] font-medium text-night-fg">
            {plan.label}
            {plan.priceUsdMonthly ? ` · $${plan.priceUsdMonthly}/mo` : ' · $0'}
          </p>
          {plan.hostedModels && totals.costUsd > 0 && (
            <span className="font-public-mono text-[11px] text-night-fg-3">
              ~${totals.costUsd.toFixed(2)} model cost this month
            </span>
          )}
        </div>
        <p className="m-0 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          {plan.blurb}
        </p>

        {plan.hostedModels ? (
          <div className="flex flex-col gap-3">
            <UsageMeter
              label="Sessions watched"
              used={totals.sessions}
              quota={quota.sessionsWatched}
            />
            <UsageMeter label="Deep dives" used={totals.deepDives} quota={quota.deepDives} />
            <UsageMeter
              label="Investigations"
              used={totals.investigations}
              quota={quota.investigations}
            />
            <p className="m-0 font-public-sans text-[12px] leading-[1.5] text-night-fg-3">
              {quota.metered
                ? 'This workspace is on custom usage billing: nothing degrades, and usage past the included quota is billed per unit on your agreement.'
                : 'Over a budget, the agent degrades instead of stopping: sweeps thin their sampling and deep dives wait for next month. Runs with your own keys are never metered.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void upgrade('solo')}
              disabled={busyTier !== ''}
              className="ps-btn-primary"
            >
              {busyTier === 'solo'
                ? 'Opening…'
                : `Upgrade to Solo · $${PLANS.solo.priceUsdMonthly}/mo`}
            </button>
            <button
              type="button"
              onClick={() => void upgrade('team')}
              disabled={busyTier !== ''}
              className="ps-btn-ghost"
            >
              {busyTier === 'team' ? 'Opening…' : `Team · $${PLANS.team.priceUsdMonthly}/mo`}
            </button>
            <span className="font-public-sans text-[12px] text-night-fg-3">
              Hosted plans add always-on cloud runs and hosted models.
            </span>
          </div>
        )}
        {error && <ErrorRow message={error} />}
      </div>
    </Section>
  );
}

function MembersSection({ workspaceId, planId }: { workspaceId: string; planId: string }) {
  const fetcher = useCallback(() => fetchMembers(workspaceId), [workspaceId]);
  const { data: members, reload } = usePageData(fetcher);
  const entitlementsFetcher = useCallback(() => fetchEntitlements(workspaceId), [workspaceId]);
  const { data: entitlementRow } = usePageData(entitlementsFetcher);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const plan = PLANS[normalizePlanId(planId)];
  const seats = entitlementRow?.seats ?? plan.seats;
  const paid = plan.id !== 'free';
  const used = (members ?? []).length;

  async function invite() {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      await addMember(workspaceId, value);
      track('member_added', {});
      setEmail('');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the member.');
    } finally {
      setBusy(false);
    }
  }

  async function drop(userId: string) {
    setError('');
    try {
      await removeMember(workspaceId, userId);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the member.');
    }
  }

  return (
    <Section title="Members">
      <div className="ps-card flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between">
          <p className="m-0 font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
            {paid
              ? 'Everyone here shares the inbox, dossiers, and work plan.'
              : 'Seats come with the paid plans. The free plan is single-member.'}
          </p>
          <span className="font-public-mono text-[11px] text-night-fg-3">
            {used} / {seats} seat{seats === 1 ? '' : 's'}
          </span>
        </div>

        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {(members ?? []).map((member: WorkspaceMember) => (
            <li
              key={member.user_id}
              className="flex items-center justify-between gap-2 border-t border-night-4 pt-2 first:border-t-0 first:pt-0"
            >
              <span className="min-w-0 truncate font-public-sans text-[13px] text-night-fg">
                {member.email}
                <span className="ml-2 font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                  {member.role}
                </span>
              </span>
              {member.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => void drop(member.user_id)}
                  className="ps-btn-ghost"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {paid && used < seats && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="ps-input max-w-[260px]"
              placeholder="teammate@company.com"
              aria-label="Teammate email"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => void invite()}
              disabled={busy || !email.trim()}
              className="ps-btn-primary"
            >
              {busy ? 'Adding…' : 'Add member'}
            </button>
            <span className="font-public-sans text-[12px] text-night-fg-3">
              They need a Postshow account with this email first.
            </span>
          </div>
        )}
        {error && <ErrorRow message={error} />}
      </div>
    </Section>
  );
}

function TokensSection({ workspaceId }: { workspaceId: string }) {
  const fetcher = useCallback(() => fetchApiTokens(workspaceId), [workspaceId]);
  const { data: tokens, reload } = usePageData(fetcher);
  const [name, setName] = useState('');
  const [minted, setMinted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function mint() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMinted('');
    try {
      const result = await createApiToken(workspaceId, name.trim() || 'cli');
      if (!result.ok || !result.token) throw new Error(result.detail ?? 'Could not create token.');
      track('api_token_created', {});
      setMinted(result.token);
      setName('');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create token.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    try {
      await revokeApiToken(tokenId);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke token.');
    }
  }

  const active = (tokens ?? []).filter((t: ApiToken) => !t.revoked_at);

  return (
    <Section title="Access tokens">
      <div className="ps-card flex flex-col gap-3 p-5">
        <p className="m-0 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          Tokens authenticate the CLI, the MCP server, and the desktop app. Run{' '}
          <code className="font-public-mono text-[12px] text-night-fg">npx postshow init</code> and
          paste one when asked.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ps-input max-w-[220px]"
            placeholder="token name (laptop, ci…)"
            aria-label="Token name"
          />
          <button
            type="button"
            onClick={() => void mint()}
            disabled={busy}
            className="ps-btn-primary"
          >
            {busy ? 'Creating…' : 'Create token'}
          </button>
        </div>
        {minted && (
          <div className="rounded-sm border border-signal/40 bg-night-2 p-3">
            <p className="m-0 mb-1 font-public-mono text-[10px] uppercase tracking-[0.12em] text-signal">
              copy now - shown once
            </p>
            <code className="break-all font-public-mono text-[12px] text-night-fg">{minted}</code>
          </div>
        )}
        {active.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {active.map((token: ApiToken) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-2 border-t border-night-4 pt-2 first:border-t-0 first:pt-0"
              >
                <span className="font-public-sans text-[13px] text-night-fg">
                  {token.name || 'unnamed'}{' '}
                  <span className="font-public-mono text-[11px] text-night-fg-3">
                    {token.token_prefix}…
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void revoke(token.id)}
                  className="ps-btn-ghost"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <ErrorRow message={error} />}
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchEngine(workspaceId), [workspaceId]);
  const { data: engine, reload } = usePageData(fetcher);

  const [rulesText, setRulesText] = useState((workspace?.agent_rules ?? []).join('\n'));
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesStatus, setRulesStatus] = useState('');

  async function saveRules() {
    if (rulesBusy) return;
    setRulesBusy(true);
    setRulesStatus('');
    try {
      const rules = rulesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 40);
      await setAgentRules(workspaceId, rules);
      track('agent_rules_saved', { count: rules.length });
      setRulesStatus('saved');
    } catch (e) {
      setRulesStatus(e instanceof Error ? e.message : 'Could not save rules.');
    } finally {
      setRulesBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        sub="Engine, plan, house rules, and access. Keys are write-only: stored server-side, never displayed again."
      />

      <EngineSection workspaceId={workspaceId} engine={engine} reload={reload} />
      <TaskMatrixSection workspaceId={workspaceId} engine={engine} reload={reload} />
      <KeysSection workspaceId={workspaceId} />
      <PlanSection workspaceId={workspaceId} planId={workspace?.plan ?? 'free'} />
      <MembersSection workspaceId={workspaceId} planId={workspace?.plan ?? 'free'} />

      <Section title="House rules">
        <div className="ps-card flex flex-col gap-3 p-5">
          <p className="m-0 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
            Standing instructions the agent follows on every run, one per line. It proposes new ones
            through the inbox as it learns from your skips and edits; nothing is adopted without
            your approve.
          </p>
          <textarea
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            rows={6}
            aria-label="House rules"
            placeholder={
              'Never draft outreach to accounts on the enterprise plan.\nKeep ticket titles under 80 characters.'
            }
            className="w-full rounded-md border border-night-4 bg-night-2 p-3 font-public-sans text-[13px] leading-[1.6] text-night-fg placeholder:text-night-fg-3 focus:border-signal focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveRules()}
              disabled={rulesBusy}
              className="ps-btn-primary w-fit"
            >
              {rulesBusy ? 'Saving…' : 'Save rules'}
            </button>
            {rulesStatus && (
              <span
                className={
                  rulesStatus === 'saved'
                    ? 'font-public-mono text-[11px] uppercase tracking-[0.12em] text-signal'
                    : 'font-public-sans text-[13px] text-bad'
                }
              >
                {rulesStatus}
              </span>
            )}
          </div>
        </div>
      </Section>

      <TokensSection workspaceId={workspaceId} />

      <Section title="Workspace">
        <div className="ps-card flex flex-col gap-1 p-5">
          <p className="m-0 font-public-sans text-[14px] font-medium text-night-fg">
            {workspace?.name}
          </p>
          <p className="m-0 font-public-mono text-[11px] text-night-fg-3">{workspaceId}</p>
        </div>
      </Section>
    </div>
  );
}
