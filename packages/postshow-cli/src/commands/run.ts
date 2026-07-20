// `postshow run` / `postshow watch` - the local runtime. Gathers with the
// connector credentials on this machine, calls the locally-configured
// engine, and submits derived findings to the workspace through the gateway
// (which re-sanitizes and dedups them server-side). Raw gathered data never
// leaves the machine. `watch` is a heartbeat with catch-up: due-ness lives
// in persisted next-due timestamps, so a laptop that slept just runs what
// came due while it was closed.

import {
  agentSystemPrompt,
  buildPacket,
  callModel,
  packetSections,
  parseModelJson,
  resolveTaskEngine,
  taskClassForJobKind,
  githubRecentPrs,
  posthogGather,
  sentryIssues,
  stripeAccounts,
  type GithubPr,
  type ModelOutput,
  type OutcomeStats,
  type PosthogGather,
  type SentryIssue,
  type StripeAccount,
} from '@eventools/postshow-core';
import { gateway } from '../api';
import { loadConfig, type CliConfig } from '../config';
import { dim, fail, ok, say, warn } from '../ui';

interface GatewayJob {
  id: string;
  label: string;
  kind: string;
  config: Record<string, unknown>;
}

function localSecrets(config: CliConfig, provider: string) {
  return config.connectors.find((c) => c.provider === provider) ?? null;
}

async function executeLocalJob(config: CliConfig, job: GatewayJob): Promise<void> {
  say(`running: ${job.label}`);
  const taskClass = taskClassForJobKind(job.kind);
  const engine = resolveTaskEngine(taskClass, config.engine, config.taskPrefs);
  if (engine.mode === 'hosted') {
    warn('this task resolves to the hosted engine; local runs need byok or local. skipping.');
    return;
  }
  const apiKey = config.keys[engine.provider] ?? '';

  const windowDays = job.kind === 'deep_dive' ? 7 : 1;
  let posthog: PosthogGather | null = null;
  let stripe: StripeAccount[] | null = null;
  let sentry: SentryIssue[] | null = null;
  let github: GithubPr[] | null = null;

  const ph = localSecrets(config, 'posthog');
  if (ph) {
    posthog = await posthogGather(ph.meta, ph.secret, windowDays);
    dim(`  posthog: ${posthog.samples.length} session samples`);
  }
  const st = localSecrets(config, 'stripe');
  if (st) {
    stripe = await stripeAccounts(st.secret);
    dim(`  stripe: ${stripe.length} subscriptions`);
  }
  const se = localSecrets(config, 'sentry');
  if (se) {
    sentry = await sentryIssues(se.meta, se.secret);
    dim(`  sentry: ${sentry.length} issues`);
  }
  const gh = localSecrets(config, 'github');
  if (gh) {
    github = await githubRecentPrs(gh.meta, gh.secret, windowDays);
    dim(`  github: ${github.length} merged PRs`);
  }

  const [workspaceInfo, scratchpadInfo, findingsInfo, approvedInfo, skippedInfo] =
    await Promise.all([
      gateway<{ workspace: { agent_rules: string[] } }>(config, 'workspace.get'),
      gateway<{ scratchpad: { key: string; content: string }[] }>(config, 'scratchpad.list'),
      gateway<{ fingerprints: string[] }>(config, 'findings.list'),
      gateway<{ items: { title: string }[] }>(config, 'inbox.list', {
        state: 'approved',
        limit: 50,
      }),
      gateway<{ items: { title: string }[] }>(config, 'inbox.list', {
        state: 'skipped',
        limit: 50,
      }),
    ]);
  const outcomes: OutcomeStats = {
    approved: approvedInfo.items.length,
    skipped: skippedInfo.items.length,
    recentSkips: skippedInfo.items.slice(0, 5).map((item) => item.title),
  };

  const packet = buildPacket({
    jobLabel: job.label,
    jobKind: job.kind,
    focus:
      job.kind === 'investigation'
        ? `the standing question: ${String(job.config.question ?? job.label)}`
        : undefined,
    rules: workspaceInfo.workspace.agent_rules ?? [],
    scratchpad: scratchpadInfo.scratchpad,
    knownFingerprints: findingsInfo.fingerprints,
    outcomes,
    sections: packetSections({ posthog, stripe, sentry, github }),
  });

  try {
    const result = await callModel(engine, apiKey, {
      system: agentSystemPrompt(taskClass),
      prompt: packet,
      maxTokens: taskClass === 'deep_dive' ? 8000 : 4000,
    });
    const output = parseModelJson<ModelOutput>(result.text);
    const submitted = await gateway<{ items: number; notes: number }>(config, 'runs.submit', {
      job_id: job.id,
      task_class: taskClass,
      status: 'ok',
      output,
      sessions_watched: posthog?.samples.length ?? 0,
      usage: {
        provider: engine.provider,
        model: engine.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      },
    });
    ok(
      `${job.label}: ${submitted.items ?? 0} draft(s), ${submitted.notes ?? 0} field note(s) synced`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'local run failed';
    fail(`${job.label}: ${message}`);
    await gateway(config, 'runs.submit', {
      job_id: job.id,
      task_class: taskClass,
      status: 'error',
      error: message,
    }).catch(() => {});
  }
}

export async function runOnce(jobId?: string): Promise<number> {
  const config = loadConfig();
  if (!config.token) {
    fail('no access token; run `postshow init` first');
    return 1;
  }

  const due = await gateway<{ jobs: GatewayJob[] }>(config, 'jobs.due_local');
  let jobs = due.jobs;
  if (jobId) {
    const all = await gateway<{ jobs: GatewayJob[] }>(config, 'jobs.list');
    jobs = all.jobs.filter((j) => j.id === jobId);
    if (!jobs.length) {
      fail(`job not found: ${jobId}`);
      return 1;
    }
  }
  if (!jobs.length) {
    dim('nothing due. jobs marked "runs locally" appear here when their time comes.');
    return 0;
  }
  for (const job of jobs) {
    await executeLocalJob(config, job);
  }
  return 0;
}

export async function runWatch(intervalMinutes: number): Promise<number> {
  const interval = Math.max(5, intervalMinutes);
  say(`watching for due local jobs every ${interval} min. ctrl-c to stop.`);
  for (;;) {
    try {
      await runOnce();
    } catch (error) {
      warn(error instanceof Error ? error.message : 'heartbeat failed; will retry');
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 60_000));
  }
}
