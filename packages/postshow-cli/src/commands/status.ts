// `postshow status` and `postshow doctor` - one glance at the workspace, and
// a diagnostic pass over the local setup (config, token, connectors, engine).

import {
  callModel,
  describeCadence,
  getProvider,
  resolveTaskEngine,
} from '@eventools/postshow-core';
import { gateway } from '../api';
import { configPath, loadConfig } from '../config';
import { detectOllama } from '../detect';
import { dim, fail, ok, say, warn } from '../ui';

interface StatusPayload {
  workspace: { id: string; name: string; plan: string };
  plan: { id: string; label: string; quota: Record<string, number> };
  usage: { sessionsWatched: number; deepDives: number; investigations: number };
}

export async function runStatus(): Promise<number> {
  const config = loadConfig();
  const status = await gateway<StatusPayload>(config, 'workspace.get');
  const jobs = await gateway<{
    jobs: {
      label: string;
      status: string;
      runtime: string;
      schedule_cron: string | null;
      interval_minutes: number | null;
      last_run_at: string | null;
    }[];
  }>(config, 'jobs.list');
  const inbox = await gateway<{ items: unknown[] }>(config, 'inbox.list', { state: 'pending' });

  say('');
  say(`${status.workspace.name} · ${status.plan.label} plan`);
  dim(
    `usage this month: ${status.usage.sessionsWatched} sessions watched · ${status.usage.deepDives} deep dives · ${status.usage.investigations} investigations`
  );
  say('');
  say(`inbox: ${inbox.items.length} pending`);
  say('work plan:');
  for (const job of jobs.jobs) {
    const cadence = describeCadence({
      schedule_cron: job.schedule_cron,
      interval_minutes: job.interval_minutes,
    });
    dim(
      `  ${job.status === 'active' ? '●' : '○'} ${job.label} · ${cadence} · ${job.runtime}${job.last_run_at ? ` · last ${job.last_run_at.slice(0, 16).replace('T', ' ')}` : ''}`
    );
  }
  return 0;
}

export async function runDoctor(): Promise<number> {
  const config = loadConfig();
  let problems = 0;

  say('');
  say('postshow doctor');
  dim(configPath());
  say('');

  if (!config.token) {
    fail('no access token (run `postshow init`)');
    return 1;
  }
  ok('access token present');

  try {
    const status = await gateway<StatusPayload>(config, 'workspace.get');
    ok(`workspace reachable: ${status.workspace.name} (${status.plan.label})`);
  } catch (error) {
    fail(`workspace unreachable: ${error instanceof Error ? error.message : 'unknown'}`);
    return 1;
  }

  for (const connector of config.connectors) {
    ok(
      `${connector.provider}: credentials on this machine${connector.localOnly ? ' (local-only)' : ''}`
    );
  }
  if (!config.connectors.length) {
    warn('no local connector credentials; local runs will gather nothing');
    problems += 1;
  }

  const engine = resolveTaskEngine('narration', config.engine, config.taskPrefs);
  const provider = getProvider(engine.provider);
  if (engine.mode === 'hosted') {
    dim('engine: hosted (cloud runs only; local runs need byok or local)');
  } else if (provider?.requiresKey && !config.keys[engine.provider]) {
    warn(`engine: no local ${provider.label} key; narration will be skipped locally`);
    problems += 1;
  } else if (engine.provider === 'ollama') {
    const models = await detectOllama(engine.baseUrl.replace(/\/v1$/, '') || undefined);
    if (models.length) ok(`ollama reachable (${models.length} models)`);
    else {
      warn('ollama not reachable on the configured base URL');
      problems += 1;
    }
  } else {
    ok(`engine: ${engine.mode}/${engine.provider}/${engine.model}`);
  }

  if (engine.mode !== 'hosted' && config.keys[engine.provider]) {
    try {
      await callModel(engine, config.keys[engine.provider] ?? '', {
        system: 'Reply with the word ok.',
        prompt: 'ok?',
        maxTokens: 10,
      });
      ok('engine answers');
    } catch (error) {
      fail(`engine call failed: ${error instanceof Error ? error.message : 'unknown'}`);
      problems += 1;
    }
  }

  say('');
  if (problems === 0) say('all clear.');
  else say(`${problems} thing(s) worth fixing.`);
  return problems === 0 ? 0 : 1;
}
