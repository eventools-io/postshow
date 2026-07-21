// `postshow status` and `postshow doctor` - one glance at the workspace, and
// a diagnostic pass over the local setup (config, token, connectors, engine).

import {
  callModel,
  describeCadence,
  getProvider,
  githubTest,
  linearTest,
  posthogTest,
  resendTest,
  resolveTaskEngine,
  sentryTest,
  stripeTest,
  type AdapterResult,
} from '@eventools/postshow-core';
import { gateway } from '../api';
import { configPath, loadConfig, type CliConfig, type LocalConnector } from '../config';
import { detectOllama } from '../detect';
import { verifyNativeCredentialStore } from '../credentials';
import { postgresTest } from '../postgres';
import { dim, fail, ok, say, warn } from '../ui';

interface StatusPayload {
  workspace: { id: string; name: string; plan: string };
  plan: { id: string; label: string; quota: Record<string, number> };
  usage: UsageOverviewRow[];
}

export interface UsageOverviewRow {
  units_kind: 'sessions_watched' | 'deep_dives' | 'investigations';
  used_units: number | string;
}

export interface UsageTotals {
  sessionsWatched: number;
  deepDives: number;
  investigations: number;
}

export interface StatusDependencies {
  loadConfig: typeof loadConfig;
  configPath: typeof configPath;
  gateway: (config: CliConfig, op: string, args?: Record<string, unknown>) => Promise<unknown>;
  detectOllama: typeof detectOllama;
  callModel: typeof callModel;
  testReadOnlyConnector: typeof testReadOnlyConnector;
  verifyNativeCredentialStore: typeof verifyNativeCredentialStore;
  dim: typeof dim;
  fail: typeof fail;
  ok: typeof ok;
  say: typeof say;
  warn: typeof warn;
}

export async function testReadOnlyConnector(
  connector: LocalConnector
): Promise<AdapterResult | null> {
  switch (connector.provider) {
    case 'posthog':
      return await posthogTest(connector.meta, connector.secret);
    case 'stripe':
      return await stripeTest(connector.secret);
    case 'sentry':
      return await sentryTest(connector.meta, connector.secret);
    case 'github':
      return await githubTest(connector.meta, connector.secret);
    case 'linear':
      return await linearTest(connector.secret, connector.meta);
    case 'resend':
      return await resendTest(connector.meta, connector.secret);
    case 'postgres':
      return await postgresTest(connector.secret);
    default:
      // Slack's only available verifier posts a message. Unknown connectors
      // likewise have no proven read-only doctor operation.
      return null;
  }
}

const statusDependencies: StatusDependencies = {
  loadConfig,
  configPath,
  gateway: (config, op, args) => gateway(config, op, args),
  detectOllama,
  callModel,
  testReadOnlyConnector,
  verifyNativeCredentialStore,
  dim,
  fail,
  ok,
  say,
  warn,
};

/** The current gateway returns the SQL `usageOverview` row array, not the
 * historical camel-case aggregate object. */
export function usageTotals(rows: UsageOverviewRow[]): UsageTotals {
  const totals: UsageTotals = { sessionsWatched: 0, deepDives: 0, investigations: 0 };
  for (const row of rows) {
    const parsed = Number(row.used_units);
    const units = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    if (row.units_kind === 'sessions_watched') totals.sessionsWatched = units;
    else if (row.units_kind === 'deep_dives') totals.deepDives = units;
    else if (row.units_kind === 'investigations') totals.investigations = units;
  }
  return totals;
}

export async function runStatus(
  dependencies: StatusDependencies = statusDependencies
): Promise<number> {
  const config = dependencies.loadConfig();
  const status = (await dependencies.gateway(config, 'workspace.get')) as StatusPayload;
  const jobs = (await dependencies.gateway(config, 'jobs.list')) as {
    jobs: {
      label: string;
      status: string;
      runtime: string;
      schedule_cron: string | null;
      interval_minutes: number | null;
      last_run_at: string | null;
    }[];
  };
  const inbox = (await dependencies.gateway(config, 'inbox.list', {
    state: 'pending',
  })) as { items: unknown[] };
  const usage = usageTotals(status.usage);

  dependencies.say('');
  dependencies.say(`${status.workspace.name} · ${status.plan.label} plan`);
  dependencies.dim(
    `usage this month: ${usage.sessionsWatched} sessions watched · ${usage.deepDives} deep dives · ${usage.investigations} investigations`
  );
  dependencies.say('');
  dependencies.say(`inbox: ${inbox.items.length} pending`);
  dependencies.say('work plan:');
  for (const job of jobs.jobs) {
    const cadence = describeCadence({
      schedule_cron: job.schedule_cron,
      interval_minutes: job.interval_minutes,
    });
    dependencies.dim(
      `  ${job.status === 'active' ? '●' : '○'} ${job.label} · ${cadence} · ${job.runtime}${job.last_run_at ? ` · last ${job.last_run_at.slice(0, 16).replace('T', ' ')}` : ''}`
    );
  }
  return 0;
}

export async function runDoctor(
  dependencies: StatusDependencies = statusDependencies
): Promise<number> {
  const config = dependencies.loadConfig();
  let problems = 0;

  dependencies.say('');
  dependencies.say('postshow doctor');
  dependencies.dim(dependencies.configPath());
  dependencies.say('');

  if (!config.token) {
    dependencies.fail('no access token (run `postshow init`)');
    return 1;
  }
  dependencies.ok('access token present');

  try {
    dependencies.verifyNativeCredentialStore();
    dependencies.ok('OS credential store write/read/delete self-test passed');
  } catch {
    // Never surface native/keyring error detail: platform libraries can
    // include backend/account metadata in their messages.
    dependencies.fail('OS credential store self-test failed');
    problems += 1;
  }

  try {
    const status = (await dependencies.gateway(config, 'workspace.get')) as StatusPayload;
    dependencies.ok(`workspace reachable: ${status.workspace.name} (${status.plan.label})`);
  } catch (error) {
    dependencies.fail(
      `workspace unreachable: ${error instanceof Error ? error.message : 'unknown'}`
    );
    return 1;
  }

  for (const connector of config.connectors) {
    if (connector.provider === 'slack') {
      if (connector.verified) {
        dependencies.warn(
          'slack: previously verified; live doctor test skipped because it would post a message'
        );
      } else {
        dependencies.warn(
          'slack: credential is unverified; live verification would post a message'
        );
        problems += 1;
      }
      continue;
    }
    let live: AdapterResult | null = null;
    try {
      live = await dependencies.testReadOnlyConnector(connector);
    } catch (error) {
      dependencies.fail(
        `${connector.provider}: live credential check failed (${error instanceof Error ? error.message : 'unknown'})`
      );
      problems += 1;
      continue;
    }
    if (!live) {
      dependencies.warn(`${connector.provider}: no read-only live credential check is available`);
      problems += 1;
    } else if (!live.ok) {
      dependencies.fail(`${connector.provider}: live credential check failed (${live.detail})`);
      problems += 1;
    } else if (!connector.verified) {
      dependencies.warn(
        `${connector.provider}: live check passed (${live.detail}), but saved verification is false; run init to verify it for local jobs`
      );
      problems += 1;
    } else {
      dependencies.ok(`${connector.provider}: live credential check passed (${live.detail})`);
    }
  }
  if (!config.connectors.length) {
    dependencies.warn(
      'no local connector credentials; local runs require a verified source connector'
    );
    problems += 1;
  } else if (
    !config.connectors.some(
      (connector) =>
        connector.verified &&
        ['posthog', 'stripe', 'sentry', 'github', 'postgres'].includes(connector.provider)
    )
  ) {
    dependencies.warn(
      'no verified PostHog, Stripe, Sentry, GitHub, or Postgres source connector for local runs'
    );
    problems += 1;
  }

  const engine = resolveTaskEngine('narration', config.engine, config.taskPrefs);
  const provider = getProvider(engine.provider);
  if (engine.mode === 'hosted') {
    dependencies.dim('engine: hosted (cloud runs only; local runs need byok or local)');
  } else if (provider?.requiresKey && !config.keys[engine.provider]) {
    dependencies.warn(`engine: no local ${provider.label} key; narration will be skipped locally`);
    problems += 1;
  } else if (engine.provider === 'ollama') {
    const models = await dependencies.detectOllama(
      engine.baseUrl.replace(/\/v1$/, '') || undefined
    );
    if (models.length) dependencies.ok(`ollama reachable (${models.length} models)`);
    else {
      dependencies.warn('ollama not reachable on the configured base URL');
      problems += 1;
    }
  } else {
    dependencies.ok(`engine: ${engine.mode}/${engine.provider}/${engine.model}`);
  }

  if (engine.mode !== 'hosted' && config.keys[engine.provider]) {
    try {
      await dependencies.callModel(engine, config.keys[engine.provider] ?? '', {
        system: 'Reply with the word ok.',
        prompt: 'ok?',
        maxTokens: 10,
      });
      dependencies.ok('engine answers');
    } catch (error) {
      dependencies.fail(
        `engine call failed: ${error instanceof Error ? error.message : 'unknown'}`
      );
      problems += 1;
    }
  }

  dependencies.say('');
  if (problems === 0) dependencies.say('all clear.');
  else dependencies.say(`${problems} thing(s) worth fixing.`);
  return problems === 0 ? 0 : 1;
}
