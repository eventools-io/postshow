// `postshow init` - the setup wizard. Modeled on PostHog's wizard flow:
// detect before asking, batch what must be asked, verify every credential
// before saving it, and keep secrets out of any model context entirely (this
// wizard is deterministic; the only AI in Postshow runs after setup, on
// gathered data). Local-only connectors keep their credentials in
// the OS credential store and never register a secret with the cloud. The
// JSON profile contains only opaque credential references.

import {
  CATALOG,
  callModel,
  getProvider,
  posthogTest,
  resendTest,
  sentryTest,
  slackTest,
  stripeTest,
  githubTest,
  linearTest,
  tierDefault,
  type AdapterResult,
  type EngineProviderId,
  type ResolvedEngine,
} from '@eventools/postshow-core';
import { gateway } from '../api';
import { loadConfig, saveConfig, configPath, type CliConfig, type LocalConnector } from '../config';
import { detectConnectors, detectOllama } from '../detect';
import { postgresTest } from '../postgres';
import { ask, askSecret, choose, confirm, dim, fail, heading, ok, say, warn } from '../ui';

export interface ConnectorPlan {
  provider: string;
  label: string;
  evidence: string;
  fields: { key: string; question: string; secret: boolean; meta?: boolean }[];
  test: (meta: Record<string, unknown>, secret: Record<string, unknown>) => Promise<AdapterResult>;
  /** The provider cannot ever be registered with a cloud-side credential. */
  forceLocalOnly?: boolean;
  /** `postshow run` gathers evidence from this provider on the machine that
   * executes the job, so a device needs its own copy of the credential. */
  localSource?: boolean;
}

export interface ConnectorSetupDependencies {
  ask: typeof ask;
  askSecret: typeof askSecret;
  confirm: typeof confirm;
  dim: typeof dim;
  fail: typeof fail;
  gateway: (config: CliConfig, op: string, args: Record<string, unknown>) => Promise<unknown>;
  heading: typeof heading;
  ok: typeof ok;
  say: typeof say;
  warn: typeof warn;
  saveConfig: typeof saveConfig;
}

const connectorSetupDependencies: ConnectorSetupDependencies = {
  ask,
  askSecret,
  confirm,
  dim,
  fail,
  gateway: (config, op, args) => gateway(config, op, args),
  heading,
  ok,
  say,
  warn,
  saveConfig,
};

async function gatewayWithRetry(
  config: CliConfig,
  op: string,
  args: Record<string, unknown>,
  call: (config: CliConfig, op: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await call(config, op, args);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const CONNECTOR_PLANS: ConnectorPlan[] = [
  {
    provider: 'posthog',
    label: 'PostHog (sessions + events)',
    evidence: '',
    fields: [
      { key: 'host', question: 'PostHog host', secret: false, meta: true },
      { key: 'project_id', question: 'PostHog project id', secret: false, meta: true },
      { key: 'api_key', question: 'PostHog personal API key (read-only)', secret: true },
    ],
    test: (meta, secret) => posthogTest(meta, secret),
    localSource: true,
  },
  {
    provider: 'stripe',
    label: 'Stripe (revenue)',
    evidence: '',
    fields: [
      { key: 'api_key', question: 'Stripe restricted key (read-only, rk_...)', secret: true },
    ],
    test: (_meta, secret) => stripeTest(secret),
    localSource: true,
  },
  {
    provider: 'postgres',
    label: 'Postgres (your explicit read-only query)',
    evidence: '',
    fields: [
      {
        key: 'connection_string',
        question: 'Postgres connection string (use a read-only database user)',
        secret: true,
      },
      {
        key: 'query',
        question: 'One read-only SELECT query for Postshow',
        secret: true,
      },
    ],
    test: (_meta, secret) => postgresTest(secret),
    forceLocalOnly: true,
    localSource: true,
  },
  {
    provider: 'sentry',
    label: 'Sentry (errors)',
    evidence: '',
    fields: [
      { key: 'org_slug', question: 'Sentry org slug', secret: false, meta: true },
      { key: 'project_slug', question: 'Sentry project slug', secret: false, meta: true },
      { key: 'token', question: 'Sentry auth token (read-only)', secret: true },
    ],
    test: (meta, secret) => sentryTest(meta, secret),
    localSource: true,
  },
  {
    provider: 'github',
    label: 'GitHub (repo context + tickets)',
    evidence: '',
    fields: [
      { key: 'repo', question: 'Repository (owner/name)', secret: false, meta: true },
      { key: 'token', question: 'GitHub token', secret: true },
    ],
    test: (meta, secret) => githubTest(meta, secret),
    localSource: true,
  },
  {
    provider: 'linear',
    label: 'Linear (tickets)',
    evidence: '',
    fields: [
      { key: 'team_key', question: 'Linear team key', secret: false, meta: true },
      { key: 'api_key', question: 'Linear API key', secret: true },
    ],
    test: (_meta, secret) => linearTest(secret),
  },
  {
    provider: 'resend',
    label: 'Resend (send approved outreach)',
    evidence: '',
    fields: [
      { key: 'from', question: 'From address (e.g. cj@yourdomain.com)', secret: false, meta: true },
      { key: 'api_key', question: 'Resend API key', secret: true },
    ],
    test: (meta, secret) => resendTest(meta, secret),
  },
  {
    provider: 'slack',
    label: 'Slack (the debrief channel)',
    evidence: '',
    fields: [{ key: 'webhook_url', question: 'Slack incoming-webhook URL', secret: true }],
    test: (_meta, secret) => slackTest(secret),
  },
];

export interface WorkspaceConnection {
  provider: string;
  status: string;
  local_only: boolean;
}

export type ConnectorSetupState =
  /** Nothing left to ask: this device holds a verified credential, or the
   * workspace connection already covers everything Postshow reads. */
  | 'satisfied'
  /** The workspace is connected, but nothing on this machine can gather from
   * it. A workspace connection never hands a credential back to a device, so
   * the only way out is to enter it here. */
  | 'device-credential-missing'
  | 'unconfigured';

export function connectorSetupState(
  plan: ConnectorPlan,
  connections: WorkspaceConnection[],
  local: LocalConnector[]
): ConnectorSetupState {
  if (local.some((connector) => connector.provider === plan.provider && connector.verified)) {
    return 'satisfied';
  }
  const connection = connections.find(
    (candidate) => candidate.provider === plan.provider && candidate.status === 'connected'
  );
  if (!connection) return 'unconfigured';
  return plan.localSource === true || connection.local_only
    ? 'device-credential-missing'
    : 'satisfied';
}

export async function setupConnector(
  config: CliConfig,
  plan: ConnectorPlan,
  evidence: string,
  dependencies: ConnectorSetupDependencies = connectorSetupDependencies
): Promise<void> {
  dependencies.heading(plan.label);
  if (evidence) dependencies.dim(`detected via ${evidence}`);

  const meta: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const field of plan.fields) {
    const fallback = field.key === 'host' ? 'https://us.posthog.com' : '';
    const value = field.secret
      ? await dependencies.askSecret(field.question)
      : await dependencies.ask(field.question, fallback);
    if (!value) {
      if (field.secret) {
        throw new Error(`${plan.provider} credential is required`);
      }
      continue;
    }
    if (field.meta) meta[field.key] = value;
    else secret[field.key] = value;
  }

  dependencies.say('testing…');
  try {
    const result = await plan.test(meta, secret);
    if (!result.ok) throw new Error(result.detail || 'connection test failed');
    dependencies.ok(result.detail);
  } catch (error) {
    dependencies.fail(error instanceof Error ? error.message : 'connection test failed');
    throw new Error(`${plan.provider} credential verification failed`);
  }

  const localOnly = plan.forceLocalOnly
    ? true
    : await dependencies.confirm(
        'Keep this connector local-only? (credentials stay here; source data goes only to your selected model; only findings sync)',
        false
      );
  if (plan.forceLocalOnly) {
    dependencies.dim('local-only: connection string and query stay in the OS credential store');
  }

  const connector: LocalConnector = {
    provider: plan.provider,
    label: '',
    localOnly,
    verified: true,
    meta,
    secret,
  };
  config.connectors = [...config.connectors.filter((c) => c.provider !== plan.provider), connector];

  // Commit the already-verified credential to the native store before any
  // remote mutation. If this fails, the cloud stays untouched. If a later
  // network call fails, the next setup attempt can recover from local state.
  dependencies.saveConfig(config);

  const upsert = (await gatewayWithRetry(
    config,
    'connections.upsert',
    {
      provider: plan.provider,
      local_only: localOnly,
      meta,
      secret: localOnly ? null : secret,
      verified: true,
    },
    dependencies.gateway
  )) as { connection_id?: unknown };
  const connectionId = String(upsert.connection_id ?? '');
  if (!connectionId) throw new Error(`${plan.provider} registration returned no connection id`);

  if (!localOnly) {
    if (plan.provider === 'slack') {
      dependencies.warn('cloud verification sends one additional Slack test message');
    }
    const verifyArgs = {
      connection_id: connectionId,
      ...(plan.provider === 'slack' ? { send_test_message: true } : {}),
    };
    try {
      await dependencies.gateway(config, 'connections.verify', verifyArgs);
    } catch (firstError) {
      // The verification may have committed before the response was lost.
      // Read back before any retry so Slack never receives a duplicate test.
      const afterError = (await gatewayWithRetry(
        config,
        'connections.list',
        {},
        dependencies.gateway
      )) as {
        connections?: { provider?: unknown; status?: unknown; local_only?: unknown }[];
      };
      const committed = afterError.connections?.find((entry) => entry.provider === plan.provider);
      if (committed?.status !== 'connected' || committed.local_only !== false) {
        if (plan.provider === 'slack') throw firstError;
        await dependencies.gateway(config, 'connections.verify', verifyArgs);
      }
    }
  }

  const readback = (await gatewayWithRetry(
    config,
    'connections.list',
    {},
    dependencies.gateway
  )) as {
    connections?: { provider?: unknown; status?: unknown; local_only?: unknown }[];
  };
  const saved = readback.connections?.find((entry) => entry.provider === plan.provider);
  if (!saved || saved.status !== 'connected' || saved.local_only !== localOnly) {
    throw new Error(`${plan.provider} did not read back as connected`);
  }

  dependencies.ok(localOnly ? 'registered (credentials stay local)' : 'connected to the workspace');
}

export interface EngineSetupDependencies {
  ask: typeof ask;
  askSecret: typeof askSecret;
  callModel: typeof callModel;
  choose: typeof choose;
  confirm: typeof confirm;
  detectOllama: typeof detectOllama;
  dim: typeof dim;
  gateway: (config: CliConfig, op: string, args: Record<string, unknown>) => Promise<unknown>;
  heading: typeof heading;
  ok: typeof ok;
  saveConfig: typeof saveConfig;
  say: typeof say;
}

const engineSetupDependencies: EngineSetupDependencies = {
  ask,
  askSecret,
  callModel,
  choose,
  confirm,
  detectOllama,
  dim,
  gateway: (config, op, args) => gateway(config, op, args),
  heading,
  ok,
  saveConfig,
  say,
};

async function probeEngine(
  engine: ResolvedEngine,
  key: string,
  dependencies: EngineSetupDependencies
): Promise<void> {
  const result = await dependencies.callModel(engine, key, {
    system: 'This is a credential and model availability check.',
    prompt: 'Reply with a short acknowledgement.',
    maxTokens: 16,
  });
  if (!result.text.trim()) throw new Error('engine returned an empty response');
}

export async function setupEngine(
  config: CliConfig,
  dependencies: EngineSetupDependencies = engineSetupDependencies
): Promise<void> {
  dependencies.heading('Engine');
  dependencies.say('Postshow runs on the model you choose, per task: a fast tier watches');
  dependencies.say('sessions, a frontier tier runs deep dives. Pick where the models run.');

  const ollamaModels = await dependencies.detectOllama();
  const options = ollamaModels.length ? ['byok', 'local', 'hosted'] : ['byok', 'hosted'];
  if (ollamaModels.length) {
    dependencies.dim(
      `ollama detected with ${ollamaModels.length} model(s): ${ollamaModels.slice(0, 4).join(', ')}`
    );
  }
  const mode = (await dependencies.choose('Engine mode', options, 'byok')) as
    | 'byok'
    | 'local'
    | 'hosted';

  if (mode === 'hosted') {
    dependencies.say(
      'Hosted models come with the Solo and Team plans; manage them in the web app.'
    );
    config.engine = { mode: 'hosted', provider: 'anthropic', model: '', base_url: '' };
    dependencies.saveConfig(config);
    await gatewayWithRetry(
      config,
      'engine.set',
      { mode: 'hosted', provider: 'anthropic' },
      dependencies.gateway
    );
    const readback = (await gatewayWithRetry(config, 'engine.get', {}, dependencies.gateway)) as {
      defaults?: { mode?: unknown; provider?: unknown } | null;
    };
    if (readback.defaults?.mode !== 'hosted' || readback.defaults.provider !== 'anthropic') {
      throw new Error('hosted engine did not read back from the workspace');
    }
    return;
  }

  if (mode === 'local') {
    const model = await dependencies.ask('Ollama model', ollamaModels[0] ?? 'llama3.3');
    if (!model) throw new Error('a local model is required');
    await probeEngine(
      {
        mode: 'local',
        provider: 'ollama',
        model,
        taskClass: 'narration',
        effort: 'minimal',
        baseUrl: 'http://localhost:11434/v1',
      },
      '',
      dependencies
    );
    config.engine = {
      mode: 'local',
      provider: 'ollama',
      model,
      base_url: 'http://localhost:11434/v1',
    };
    dependencies.saveConfig(config);
    await gatewayWithRetry(
      config,
      'engine.set',
      {
        mode: 'local',
        provider: 'ollama',
        model,
        base_url: 'http://localhost:11434/v1',
      },
      dependencies.gateway
    );
    const readback = (await gatewayWithRetry(config, 'engine.get', {}, dependencies.gateway)) as {
      defaults?: { mode?: unknown; provider?: unknown; model?: unknown } | null;
    };
    if (
      readback.defaults?.mode !== 'local' ||
      readback.defaults.provider !== 'ollama' ||
      readback.defaults.model !== model
    ) {
      throw new Error('local engine did not read back from the workspace');
    }
    dependencies.ok(`local engine set: ollama/${model}`);
    return;
  }

  const providerIds = CATALOG.filter((p) => p.requiresKey && p.models.length > 0).map((p) => p.id);
  const providerId = (await dependencies.choose(
    'Provider',
    providerIds,
    'anthropic'
  )) as EngineProviderId;
  const provider = getProvider(providerId);
  const suggested = tierDefault(providerId, 'standard')?.id ?? '';
  dependencies.say(`models: ${provider?.models.map((m) => m.id).join(', ')}`);
  const model = await dependencies.ask(
    'Default model (per-task defaults fill the rest)',
    suggested
  );
  const key = await dependencies.askSecret(`${provider?.label} API key`);
  if (!model) throw new Error('a model is required');
  if (!key) throw new Error(`${provider?.label ?? providerId} API key is required`);
  await probeEngine(
    {
      mode: 'byok',
      provider: providerId,
      model,
      taskClass: 'narration',
      effort: 'minimal',
      baseUrl: '',
    },
    key,
    dependencies
  );

  config.engine = { mode: 'byok', provider: providerId, model, base_url: '' };
  config.keys[providerId] = key;

  const syncKey = await dependencies.confirm(
    'Also store this key in your workspace so cloud runs can use it?',
    true
  );
  dependencies.saveConfig(config);
  await gatewayWithRetry(
    config,
    'engine.set',
    {
      mode: 'byok',
      provider: providerId,
      model,
      api_key: syncKey ? key : undefined,
    },
    dependencies.gateway
  );
  if (!syncKey) {
    // “Local-only” is an exact state, not merely a promise not to upload the
    // new value. Remove any older workspace copy for this provider as well.
    await gatewayWithRetry(
      config,
      'engine.set_key',
      { provider: providerId, key: '' },
      dependencies.gateway
    );
  }
  const readback = (await gatewayWithRetry(config, 'engine.get', {}, dependencies.gateway)) as {
    defaults?: { mode?: unknown; provider?: unknown; model?: unknown } | null;
    key_providers?: unknown;
  };
  if (
    readback.defaults?.mode !== 'byok' ||
    readback.defaults.provider !== providerId ||
    readback.defaults.model !== model ||
    !Array.isArray(readback.key_providers) ||
    (syncKey && !readback.key_providers.includes(providerId)) ||
    (!syncKey && readback.key_providers.includes(providerId))
  ) {
    throw new Error('BYOK engine did not read back from the workspace');
  }
  dependencies.ok(
    `engine set: byok/${providerId}${model ? `/${model}` : ''}${syncKey ? ' (key synced)' : ' (key local-only)'}`
  );
}

export async function runInit(): Promise<number> {
  say('');
  say('postshow init - the after-show report, every day, run by an agent.');
  dim('Detects your stack, verifies each connector before saving, and never');
  dim('sends a credential through a model.');

  const config = loadConfig();

  heading('Access token');
  if (config.token) {
    dim('token already configured');
  } else {
    say('Create one in the web app: Settings → Access tokens → Create token.');
    const token = await askSecret('Paste your token (psh_...)');
    if (!token.startsWith('psh_')) {
      fail('that does not look like a Postshow token');
      return 1;
    }
    config.token = token;
  }

  const apiUrl = await ask('API URL (shown beside the token in Settings)', config.apiUrl);
  if (!apiUrl) {
    fail('the API URL is required; copy it from Settings next to your token');
    return 1;
  }
  config.apiUrl = apiUrl;

  let workspace: { id: string; name: string };
  try {
    const result = await gateway<{ workspace: { id: string; name: string } }>(
      config,
      'workspace.get'
    );
    workspace = result.workspace;
  } catch (error) {
    fail(error instanceof Error ? error.message : 'could not reach the workspace');
    return 1;
  }
  config.workspaceId = workspace.id;
  config.workspaceName = workspace.name;
  ok(`workspace: ${workspace.name}`);
  try {
    // Persist the verified access token/workspace before later setup stages so
    // connector or engine failures are resumable without re-entering it.
    saveConfig(config);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'could not save the local profile');
    return 1;
  }

  heading('Connectors');
  const detected = detectConnectors(process.cwd());
  if (detected.length) {
    say(`Found ${detected.length} likely connector(s) in this directory:`);
    for (const hit of detected) dim(`  ${hit.provider} - ${hit.evidence}`);
  } else {
    dim('nothing auto-detected in this directory; you can still add connectors');
  }

  const existing = await gateway<{ connections: WorkspaceConnection[] }>(
    config,
    'connections.list'
  );

  for (const plan of CONNECTOR_PLANS) {
    const state = connectorSetupState(plan, existing.connections, config.connectors);
    if (state === 'satisfied') {
      dim(`${plan.provider}: already connected, skipping`);
      continue;
    }
    if (state === 'device-credential-missing') {
      say(`${plan.provider} is connected in the workspace but not on this machine.`);
      dim('a workspace connection never supplies a credential to a device; enter it here');
    }
    const hit = detected.find((d) => d.provider === plan.provider);
    const wanted = await confirm(
      `Set up ${plan.label}?`,
      state === 'device-credential-missing' || Boolean(hit) || plan.provider === 'posthog'
    );
    if (!wanted) continue;
    try {
      await setupConnector(config, plan, hit?.evidence ?? '');
    } catch (error) {
      fail(error instanceof Error ? error.message : `${plan.provider} setup failed`);
      return 1;
    }
  }

  try {
    await setupEngine(config);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'engine setup failed');
    return 1;
  }

  try {
    saveConfig(config);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'could not save the local profile');
    return 1;
  }
  heading('Done');
  ok(`profile saved to ${configPath()}`);
  say('');
  say('Next moves:');
  say('  postshow run            execute due local jobs once');
  say('  postshow watch          keep running them on a heartbeat');
  say('  postshow inbox          review what the agent drafted');
  say('  postshow mcp            expose the workspace to your coding agent');
  say('');
  say('The nightly session sweep and weekly deep dive are already on the');
  say('work plan. Approve or veto anything the agent proposes in the web app.');
  return 0;
}
