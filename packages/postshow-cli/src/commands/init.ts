// `postshow init` - the setup wizard. Modeled on PostHog's wizard flow:
// detect before asking, batch what must be asked, verify every credential
// before saving it, and keep secrets out of any model context entirely (this
// wizard is deterministic; the only AI in Postshow runs after setup, on
// gathered data). Local-only connectors keep their credentials in
// ~/.postshow/config.json and never register a secret with the cloud.

import {
  CATALOG,
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
} from '@eventools/postshow-core';
import { gateway } from '../api';
import { loadConfig, saveConfig, configPath, type CliConfig, type LocalConnector } from '../config';
import { detectConnectors, detectOllama } from '../detect';
import { ask, choose, confirm, dim, fail, heading, ok, say, warn } from '../ui';

interface ConnectorPlan {
  provider: string;
  label: string;
  evidence: string;
  fields: { key: string; question: string; secret: boolean; meta?: boolean }[];
  test: (meta: Record<string, unknown>, secret: Record<string, unknown>) => Promise<AdapterResult>;
}

const CONNECTOR_PLANS: ConnectorPlan[] = [
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
  },
  {
    provider: 'stripe',
    label: 'Stripe (revenue)',
    evidence: '',
    fields: [
      { key: 'api_key', question: 'Stripe restricted key (read-only, rk_...)', secret: true },
    ],
    test: (_meta, secret) => stripeTest(secret),
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
  },
  {
    provider: 'linear',
    label: 'Linear (tickets)',
    evidence: '',
    fields: [
      { key: 'team_key', question: 'Linear team key (optional)', secret: false, meta: true },
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
    test: (_meta, secret) => resendTest(secret),
  },
  {
    provider: 'slack',
    label: 'Slack (the debrief channel)',
    evidence: '',
    fields: [{ key: 'webhook_url', question: 'Slack incoming-webhook URL', secret: true }],
    test: (_meta, secret) => slackTest(secret),
  },
];

async function setupConnector(
  config: CliConfig,
  plan: ConnectorPlan,
  evidence: string
): Promise<void> {
  heading(plan.label);
  if (evidence) dim(`detected via ${evidence}`);

  const meta: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const field of plan.fields) {
    const fallback = field.key === 'host' ? 'https://us.posthog.com' : '';
    const value = await ask(field.question, fallback);
    if (!value) {
      if (field.secret) {
        warn(`skipping ${plan.provider}: no credential entered`);
        return;
      }
      continue;
    }
    if (field.meta) meta[field.key] = value;
    else secret[field.key] = value;
  }

  say('testing…');
  try {
    const result = await plan.test(meta, secret);
    ok(result.detail);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'connection test failed');
    if (!(await confirm('Save it anyway?', false))) return;
  }

  const localOnly = await confirm(
    'Keep this connector local-only? (credentials stay on this machine; only derived findings sync)',
    false
  );

  const connector: LocalConnector = {
    provider: plan.provider,
    label: '',
    localOnly,
    meta,
    secret,
  };
  config.connectors = [...config.connectors.filter((c) => c.provider !== plan.provider), connector];

  await gateway(config, 'connections.upsert', {
    provider: plan.provider,
    local_only: localOnly,
    meta,
    secret: localOnly ? null : secret,
    verified: true,
  });
  ok(localOnly ? 'registered (credentials stay local)' : 'connected to the workspace');
}

async function setupEngine(config: CliConfig): Promise<void> {
  heading('Engine');
  say('Postshow runs on the model you choose, per task: a fast tier watches');
  say('sessions, a frontier tier runs deep dives. Pick where the models run.');

  const ollamaModels = await detectOllama();
  const options = ollamaModels.length ? ['byok', 'local', 'hosted'] : ['byok', 'hosted'];
  if (ollamaModels.length) {
    dim(
      `ollama detected with ${ollamaModels.length} model(s): ${ollamaModels.slice(0, 4).join(', ')}`
    );
  }
  const mode = (await choose('Engine mode', options, 'byok')) as 'byok' | 'local' | 'hosted';

  if (mode === 'hosted') {
    say('Hosted models come with the Solo and Team plans; manage them in the web app.');
    config.engine = { mode: 'hosted', provider: 'anthropic', model: '', base_url: '' };
    await gateway(config, 'engine.set', { mode: 'hosted', provider: 'anthropic' });
    return;
  }

  if (mode === 'local') {
    const model = await ask('Ollama model', ollamaModels[0] ?? 'llama3.3');
    config.engine = {
      mode: 'local',
      provider: 'ollama',
      model,
      base_url: 'http://localhost:11434/v1',
    };
    await gateway(config, 'engine.set', {
      mode: 'local',
      provider: 'ollama',
      model,
      base_url: 'http://localhost:11434/v1',
    });
    ok(`local engine set: ollama/${model}`);
    return;
  }

  const providerIds = CATALOG.filter((p) => p.requiresKey && p.models.length > 0).map((p) => p.id);
  const providerId = (await choose('Provider', providerIds, 'anthropic')) as EngineProviderId;
  const provider = getProvider(providerId);
  const suggested = tierDefault(providerId, 'standard')?.id ?? '';
  say(`models: ${provider?.models.map((m) => m.id).join(', ')}`);
  const model = await ask('Default model (per-task defaults fill the rest)', suggested);
  const key = await ask(`${provider?.label} API key`);
  if (!key) {
    warn('no key entered; the agent will gather data but skip narration until one is added');
  }

  config.engine = { mode: 'byok', provider: providerId, model, base_url: '' };
  if (key) config.keys[providerId] = key;

  const syncKey = key
    ? await confirm('Also store this key in your workspace so cloud runs can use it?', true)
    : false;
  await gateway(config, 'engine.set', {
    mode: 'byok',
    provider: providerId,
    model,
    api_key: syncKey ? key : undefined,
  });
  ok(
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
    const token = await ask('Paste your token (psh_...)');
    if (!token.startsWith('psh_')) {
      fail('that does not look like a Postshow token');
      return 1;
    }
    config.token = token;
  }

  const apiUrl = await ask('API URL', config.apiUrl);
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

  heading('Connectors');
  const detected = detectConnectors(process.cwd());
  if (detected.length) {
    say(`Found ${detected.length} likely connector(s) in this directory:`);
    for (const hit of detected) dim(`  ${hit.provider} - ${hit.evidence}`);
  } else {
    dim('nothing auto-detected in this directory; you can still add connectors');
  }

  const existing = await gateway<{ connections: { provider: string; status: string }[] }>(
    config,
    'connections.list'
  );
  const alreadyConnected = new Set(
    existing.connections.filter((c) => c.status === 'connected').map((c) => c.provider)
  );

  for (const plan of CONNECTOR_PLANS) {
    if (alreadyConnected.has(plan.provider)) {
      dim(`${plan.provider}: already connected, skipping`);
      continue;
    }
    const hit = detected.find((d) => d.provider === plan.provider);
    const wanted = await confirm(
      `Set up ${plan.label}?`,
      Boolean(hit) || plan.provider === 'posthog'
    );
    if (!wanted) continue;
    await setupConnector(config, plan, hit?.evidence ?? '');
  }

  await setupEngine(config);

  saveConfig(config);
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
