import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CATALOG,
  EFFORT_LEVELS,
  TASK_CLASSES,
  TASK_CLASS_INFO,
  getProvider,
  resolveEngineEndpoint,
  resolveTaskEngine,
  type EngineDefaults,
} from '@eventools/postshow-core';
import { useWorkspace } from '@/state/WorkspaceContext';
import {
  createApiToken,
  fetchApiTokens,
  fetchEngine,
  fetchKeyProviders,
  fetchWorkspacePermissions,
  revokeApiToken,
  setAgentRules,
  setEngine,
  setEngineKey,
  setTaskPrefs,
} from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { PageHeader, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import type {
  ApiToken,
  ApiTokenCreationResult,
  EngineEffort,
  EngineProvider,
  EngineSettings,
  EngineTaskClass,
  EngineTaskPref,
} from '@/lib/types';
import { BillingSection } from '@/components/settings/BillingSection';
import { WorkspaceLifecycleSection } from '@/components/settings/WorkspaceLifecycleSection';
import { AccountDeletionSection } from '@/components/settings/AccountDeletionSection';
import { MemberManagementSection } from '@/components/settings/MemberManagementSection';
import { LegalLinks } from '@/components/LegalLinks';
import { fallbackProvider, providersForMode } from '@/lib/engineProviders';
import { SOURCE_CLI_COMMAND, SOURCE_CLI_GUIDE } from '@/lib/cli';

const MODES: { value: EngineSettings['mode']; label: string; blurb: string }[] = [
  {
    value: 'byok',
    label: 'Your keys',
    blurb: 'Bring keys for any provider in the catalog. No hosted-model charge.',
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

function providerModels(providerId: string, mode: EngineSettings['mode']) {
  const models = getProvider(providerId)?.models ?? [];
  return mode === 'hosted' ? models.filter((model) => model.hostedEligible === true) : models;
}

export function EngineSection({
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
  const [compatibleKey, setCompatibleKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const keysFetcher = useCallback(() => fetchKeyProviders(workspaceId), [workspaceId]);
  const { data: configuredKeys, reload: reloadKeys } = usePageData(keysFetcher);

  useEffect(() => {
    if (!engine) return;
    setMode(engine.mode);
    setProvider(engine.provider);
    setModel(engine.model);
    setBaseUrl(engine.base_url);
  }, [engine]);

  const availableProviders = providersForMode(mode);
  const models = providerModels(provider, mode);
  const needsBaseUrl = provider === 'compatible' || provider === 'ollama';
  let canonicalBaseUrl = baseUrl.trim();
  if (needsBaseUrl) {
    const catalogProvider = getProvider(provider);
    if (catalogProvider) {
      try {
        canonicalBaseUrl = resolveEngineEndpoint(
          {
            taskClass: 'narration',
            mode,
            provider,
            model: model.trim(),
            effort: 'low',
            baseUrl: canonicalBaseUrl,
          },
          catalogProvider
        );
      } catch {
        // Submit surfaces the precise validation error. Keeping the raw value
        // here also makes an invalid edit require fresh credential binding.
      }
    }
  }
  const compatibleTargetChanged =
    provider === 'compatible' &&
    (engine?.provider !== 'compatible' || engine.base_url !== canonicalBaseUrl);
  const needsCompatibleKey =
    mode === 'byok' &&
    provider === 'compatible' &&
    (compatibleTargetChanged || !configuredKeys?.includes('compatible'));

  function chooseMode(nextMode: EngineSettings['mode']) {
    const allowed = providersForMode(nextMode);
    const nextProvider = allowed.some((candidate) => candidate.id === provider)
      ? provider
      : fallbackProvider(nextMode);
    setMode(nextMode);
    if (nextProvider !== provider) {
      setProvider(nextProvider);
      setModel('');
      setBaseUrl('');
      setCompatibleKey('');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      if (!availableProviders.some((candidate) => candidate.id === provider)) {
        throw new Error('Choose a provider that supports this engine mode.');
      }
      if ((provider === 'compatible' || provider === 'ollama') && !model.trim()) {
        throw new Error('Enter the exact model id for this endpoint.');
      }
      if (provider === 'compatible' && !baseUrl.trim()) {
        throw new Error('Enter the exact OpenAI-compatible base URL.');
      }
      let endpoint = '';
      if (needsBaseUrl) {
        const catalogProvider = getProvider(provider);
        if (!catalogProvider) {
          throw new Error('Choose a supported engine provider.');
        }
        endpoint = resolveEngineEndpoint(
          {
            taskClass: 'narration',
            mode,
            provider,
            model: model.trim(),
            effort: 'low',
            baseUrl: baseUrl.trim(),
          },
          catalogProvider
        );
      }
      if (needsCompatibleKey && !compatibleKey.trim()) {
        throw new Error('Re-enter the compatible endpoint key for this exact target.');
      }
      await setEngine({
        workspaceId,
        mode,
        provider,
        model: model.trim(),
        baseUrl: endpoint,
        apiKey: mode === 'byok' && provider === 'compatible' ? compatibleKey.trim() || null : null,
      });
      track('engine_saved', { mode, provider });
      if (needsBaseUrl) setBaseUrl(endpoint);
      setCompatibleKey('');
      setSaved(true);
      reloadKeys();
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
              onClick={() => chooseMode(option.value)}
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
                setBaseUrl('');
                setCompatibleKey('');
              }}
              className="ps-input"
            >
              {availableProviders.map((p) => (
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
          <div className="flex flex-col gap-1">
            <label htmlFor="postshow-engine-base-url">
              <span className="ps-label">Base URL</span>
            </label>
            <input
              id="postshow-engine-base-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="ps-input"
              placeholder="http://localhost:11434/v1"
              autoComplete="url"
              aria-describedby="postshow-engine-base-url-help"
            />
            <span
              id="postshow-engine-base-url-help"
              className="font-public-sans text-[11px] leading-[1.45] text-night-fg-3"
            >
              URLs cannot contain credentials, query parameters, or fragments. Local engines must
              use a loopback HTTP(S) address; remote compatible engines must use public HTTPS.
            </span>
          </div>
        )}
        {mode === 'byok' && provider === 'compatible' ? (
          <label className="flex flex-col gap-1">
            <span className="ps-label">
              Endpoint API key
              {!needsCompatibleKey && ' (leave blank to keep the current key)'}
            </span>
            <input
              type="password"
              value={compatibleKey}
              onChange={(event) => setCompatibleKey(event.target.value)}
              className="ps-input"
              autoComplete="off"
              required={needsCompatibleKey}
              placeholder={needsCompatibleKey ? 'required for this exact endpoint' : 'replace key'}
            />
            <span className="font-public-sans text-[11px] leading-[1.45] text-night-fg-3">
              Changing the compatible provider or base URL invalidates the old key so credentials
              cannot be rebound to another host.
            </span>
          </label>
        ) : null}

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

export function TaskMatrixSection({
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
            const effectiveMode = pref.mode ?? engine?.mode ?? 'byok';
            const availableProviders = providersForMode(effectiveMode).filter(
              (candidate) =>
                candidate.id !== 'compatible' ||
                (engine?.provider === 'compatible' && Boolean(engine.base_url))
            );
            const selectedProvider = pref.provider ?? resolved.provider;
            const models = providerModels(selectedProvider, effectiveMode);
            return (
              <div
                key={task}
                className="grid gap-2 rounded-sm border border-night-4 p-3 sm:grid-cols-[1.2fr_0.8fr_1fr_1fr_0.7fr]"
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
                  <span className="ps-label">Mode</span>
                  <select
                    value={pref.mode ?? ''}
                    onChange={(event) => {
                      const nextMode = event.target.value as EngineSettings['mode'] | '';
                      if (!nextMode) {
                        updatePref(task, {
                          mode: undefined,
                          provider: undefined,
                          model: undefined,
                        });
                        return;
                      }
                      const inherited = engine?.provider ?? fallbackProvider(nextMode);
                      const provider = providersForMode(nextMode).some(
                        (candidate) => candidate.id === inherited
                      )
                        ? inherited
                        : fallbackProvider(nextMode);
                      updatePref(task, { mode: nextMode, provider, model: undefined });
                    }}
                    className="ps-input"
                  >
                    <option value="">inherit</option>
                    {MODES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="ps-label">Provider</span>
                  <select
                    value={pref.provider ?? ''}
                    onChange={(e) =>
                      updatePref(task, {
                        provider: (e.target.value || undefined) as EngineProvider | undefined,
                        mode: e.target.value ? effectiveMode : pref.mode,
                        model: undefined,
                      })
                    }
                    className="ps-input"
                  >
                    <option value="">inherit</option>
                    {availableProviders.map((p) => (
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

function TokensSection({ workspaceId }: { workspaceId: string }) {
  const fetcher = useCallback(() => fetchApiTokens(workspaceId), [workspaceId]);
  const { data: tokens, reload } = usePageData(fetcher);
  const [name, setName] = useState('');
  const [minted, setMinted] = useState<ApiTokenCreationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function mint() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMinted(null);
    try {
      const result = await createApiToken(workspaceId, name.trim() || 'cli');
      track('api_token_created', {});
      setMinted(result);
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
          Tokens authenticate the CLI, the MCP server, and the desktop app. Until the first npm
          release,{' '}
          <a
            href={SOURCE_CLI_GUIDE}
            className="font-medium text-night-fg underline"
            target="_blank"
            rel="noreferrer"
          >
            build the CLI from GitHub
          </a>{' '}
          and run{' '}
          <code className="break-all font-public-mono text-[12px] text-night-fg">
            {SOURCE_CLI_COMMAND} init
          </code>{' '}
          in your product repository, then paste one when asked.
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
            <code className="break-all font-public-mono text-[12px] text-night-fg">
              {minted.token}
            </code>
            <dl className="m-0 mt-3 grid gap-1 font-public-mono text-[10px] text-night-fg-3">
              <div>
                <dt className="inline uppercase tracking-[0.1em]">Scopes: </dt>
                <dd className="m-0 inline break-words">{minted.scopes.join(', ')}</dd>
              </div>
              <div>
                <dt className="inline uppercase tracking-[0.1em]">Expires: </dt>
                <dd className="m-0 inline">
                  <time dateTime={minted.expires_at}>{minted.expires_at}</time>
                </dd>
              </div>
            </dl>
          </div>
        )}
        {active.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {active.map((token: ApiToken) => (
              <li
                key={token.id}
                className="flex flex-col gap-1 border-t border-night-4 pt-2 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="m-0 font-public-sans text-[13px] text-night-fg">
                    {token.name || 'unnamed'}{' '}
                    <span className="font-public-mono text-[11px] text-night-fg-3">
                      {token.token_prefix}…
                    </span>
                  </p>
                  <p className="m-0 mt-1 break-words font-public-mono text-[10px] text-night-fg-3">
                    scopes: {token.scopes.join(', ')}
                  </p>
                  <p className="m-0 mt-1 font-public-mono text-[10px] text-night-fg-3">
                    expires: <time dateTime={token.expires_at}>{token.expires_at}</time>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void revoke(token.id)}
                  className="ps-btn-ghost shrink-0"
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

function WorkspaceSettingsPage() {
  const { session, workspace, reloadWorkspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchEngine(workspaceId), [workspaceId]);
  const { data: engine, reload } = usePageData(fetcher);
  const permissionsFetcher = useCallback(
    () => fetchWorkspacePermissions(workspaceId),
    [workspaceId]
  );
  const {
    data: permissions,
    loading: permissionsLoading,
    error: permissionsError,
    reload: reloadPermissions,
  } = usePageData(permissionsFetcher);
  const permissionsReady =
    !permissionsLoading && !permissionsError && permissions?.workspace_id === workspaceId;

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

      {!permissionsReady ? (
        <Section title="Workspace administration">
          <div className="ps-card flex flex-col gap-3 p-4 sm:p-5">
            {permissionsError ? (
              <>
                <p className="m-0 font-public-sans text-[13px] text-bad" role="alert">
                  Workspace permissions could not be verified. Administrative controls are hidden
                  until the check succeeds.
                </p>
                <button type="button" onClick={reloadPermissions} className="ps-btn-ghost w-fit">
                  Retry permission check
                </button>
              </>
            ) : (
              <p className="m-0 font-public-sans text-[13px] text-night-fg-2" role="status">
                Checking workspace permissions…
              </p>
            )}
          </div>
        </Section>
      ) : !permissions.manage_settings &&
        !permissions.manage_members &&
        !permissions.manage_billing &&
        !permissions.delete_workspace ? (
        <Section title="Workspace administration">
          <div className="ps-card p-4 sm:p-5">
            <p className="m-0 font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
              Your workspace role has read-only access here. Ask a workspace owner or admin to
              change shared settings.
            </p>
          </div>
        </Section>
      ) : null}

      {permissionsReady && permissions.manage_settings ? (
        <>
          <EngineSection workspaceId={workspaceId} engine={engine} reload={reload} />
          <TaskMatrixSection workspaceId={workspaceId} engine={engine} reload={reload} />
          <KeysSection workspaceId={workspaceId} />
        </>
      ) : null}
      {permissionsReady && permissions.manage_billing ? (
        <BillingSection
          workspaceId={workspaceId}
          workspacePlan={workspace?.plan}
          onStandingChange={reloadWorkspace}
        />
      ) : null}
      {session && permissionsReady && permissions.manage_members ? (
        <MemberManagementSection
          workspaceId={workspaceId}
          planId={workspace?.plan ?? 'free'}
          actorId={session.user.id}
        />
      ) : null}

      {permissionsReady && permissions.manage_settings ? (
        <Section title="House rules">
          <div className="ps-card flex flex-col gap-3 p-5">
            <p className="m-0 max-w-[62ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
              Standing instructions the agent follows on every run, one per line. It proposes new
              ones through the inbox as it learns from your skips and edits; nothing is adopted
              without your approve.
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
      ) : null}

      <TokensSection workspaceId={workspaceId} />

      <Section title="Workspace identity">
        <div className="ps-card flex flex-col gap-1 p-4 sm:p-5">
          <p className="m-0 font-public-sans text-[14px] font-medium text-night-fg">
            {workspace?.name}
          </p>
          <p className="m-0 font-public-mono text-[11px] text-night-fg-3">{workspaceId}</p>
        </div>
      </Section>

      <Section title="Privacy, legal, and support">
        <div className="ps-card flex flex-col gap-3 p-4 sm:p-5">
          <p className="m-0 max-w-[68ch] font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
            Optional analytics can record product events, interactions, performance, errors,
            heatmaps, and masked session replay after consent. Page text and form fields are masked,
            and console logs and network payloads are excluded. Review or change that choice at any
            time, or contact Eventools LLC for account, privacy, security, or billing help.
          </p>
          <LegalLinks theme="dark" />
        </div>
      </Section>

      {session && permissionsReady && permissions.delete_workspace ? (
        <WorkspaceLifecycleSection
          key={`${session.user.id}:${workspaceId}`}
          session={session}
          workspaceId={workspaceId}
          workspaceName={workspace?.name ?? ''}
          onDeleted={reloadWorkspace}
        />
      ) : null}
      {session ? <AccountDeletionSection session={session} /> : null}
    </div>
  );
}

export function SettingsPage() {
  const { workspace } = useWorkspace();
  return <WorkspaceSettingsPage key={workspace?.id ?? 'no-workspace'} />;
}
