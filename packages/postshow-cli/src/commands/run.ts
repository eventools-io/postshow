// `postshow run` / `postshow watch` - the local runtime. A worker first
// obtains a server-side run claim, then gathers with verified credentials on
// this machine, calls the configured local/BYOK engine, and commits only the
// sanitized model output. Raw connector records are never synced to Postshow
// storage; the gathered packet is sent only to the user's selected model
// provider for inference.

import {
  agentSystemPrompt,
  buildPacket,
  callModel,
  githubGather,
  packetSections,
  parseModelJson,
  posthogGather,
  resolveTaskEngine,
  sanitizeModelOutput,
  sentryGather,
  sourceEvidenceContext,
  sourceIdentityContext,
  stripeSourceAccounts,
  stripeGather,
  taskClassForJobKind,
  type GatherCompleteness,
  type GatherResult,
  type GithubGather,
  type ModelOutput,
  type OutcomeStats,
  type PosthogGather,
  type SentryGather,
  type StripeAccount,
  type TaskClass,
} from '@eventools/postshow-core';
import { gateway } from '../api';
import { loadConfig, type CliConfig } from '../config';
import { postgresGather, postgresPacketSection, type PostgresSnapshot } from '../postgres';
import { dim, fail, ok, say, warn } from '../ui';
import { acquireWorkerLock, localWorkerId, WorkerBusyError, type WorkerSurface } from '../worker';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_SOURCE_PROVIDERS = new Set(['posthog', 'stripe', 'sentry', 'github', 'postgres']);
export const LEASE_HEARTBEAT_MS = 5 * 60_000;
export const MAX_LOCAL_JOBS_PER_RUN = 10;

/** Exact row returned by postshow-api `jobs.claim_local`. */
export interface GatewayJob {
  run_id: string;
  claim_token: string;
  job_id: string;
  label: string;
  kind: string;
  interval_minutes: number;
  runtime: 'local';
  config: Record<string, unknown>;
  attempt: number;
  lease_expires_at: string;
}

export type JobRunPhase =
  | 'preflight'
  | 'gather'
  | 'context'
  | 'model'
  | 'parse'
  | 'submit'
  | 'complete';
export type JobRunStatus = 'succeeded' | 'failed' | 'uncertain';

export interface JobRunResult {
  jobId: string;
  runId: string;
  label: string;
  status: JobRunStatus;
  phase: JobRunPhase;
  detail: string;
  /** True only when the server authoritatively recorded the terminal result. */
  failureReported: boolean;
}

export type RunSummaryStatus = 'idle' | 'succeeded' | 'partial' | 'failed' | 'uncertain';

export interface RunSummary {
  status: RunSummaryStatus;
  exitCode: 0 | 1;
  succeeded: number;
  failed: number;
  uncertain: number;
  jobs: JobRunResult[];
  error?: {
    phase: 'configuration' | 'discovery' | 'concurrency';
    detail: string;
  };
}

export interface RunDependencies {
  loadConfig: typeof loadConfig;
  gateway: (config: CliConfig, op: string, args?: Record<string, unknown>) => Promise<unknown>;
  callModel: typeof callModel;
  parseModelJson: (text: string) => ModelOutput;
  posthogGather: typeof posthogGather;
  stripeGather: typeof stripeGather;
  sentryGather: typeof sentryGather;
  githubGather: typeof githubGather;
  postgresGather: typeof postgresGather;
  postgresPacketSection: typeof postgresPacketSection;
  localWorkerId: typeof localWorkerId;
  acquireWorkerLock: typeof acquireWorkerLock;
  dim: typeof dim;
  fail: typeof fail;
  ok: typeof ok;
  say: typeof say;
  warn: typeof warn;
}

const runDependencies: RunDependencies = {
  loadConfig,
  gateway: (config, op, args) => gateway(config, op, args),
  callModel,
  parseModelJson: (text) => parseModelJson<ModelOutput>(text),
  posthogGather,
  stripeGather,
  sentryGather,
  githubGather,
  postgresGather,
  postgresPacketSection,
  localWorkerId,
  acquireWorkerLock,
  dim,
  fail,
  ok,
  say,
  warn,
};

interface RunCommitStats {
  items?: number;
  notes?: number;
  accounts?: number;
  source?: string;
  engine?: string;
  sessions_sampled?: number;
}

interface RunReadback {
  id: string;
  status: string;
  stats?: RunCommitStats;
  error?: string;
}

class LeaseRenewalUnconfirmedError extends Error {
  constructor() {
    super('local run lease renewal was not confirmed; the live claim will be recovered');
    this.name = 'LeaseRenewalUnconfirmedError';
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : 'local run failed';
}

/** Failure text crosses the Postshow boundary, so send only fixed operational
 * categories. Driver/model parser messages can contain snippets of source
 * data and remain local for diagnostics. */
function remoteFailureDetail(detail: string): string {
  if (/timed out/i.test(detail)) return 'local run timed out';
  if (/offline/i.test(detail)) return 'local dependency offline';
  if (/configuration/i.test(detail)) return 'local run configuration failed';
  if (/credential|api key|access token/i.test(detail)) return 'local credential check failed';
  if (/model refused/i.test(detail)) return 'model refused the request';
  if (/truncated/i.test(detail)) return 'model output was truncated';
  return 'local run failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredUuid(row: Record<string, unknown>, key: string): string {
  const value = String(row[key] ?? '');
  if (!UUID_RE.test(value)) throw new Error(`gateway local-claim ${key} is invalid`);
  return value;
}

/** Parse the gateway contract instead of letting a malformed or legacy job
 * shape execute without a run claim. */
export function parseClaimedJobs(payload: unknown): GatewayJob[] {
  if (!isRecord(payload) || !Array.isArray(payload.jobs) || payload.jobs.length > 1) {
    throw new Error('gateway returned an invalid local-claim response');
  }
  return payload.jobs.map((entry) => {
    if (!isRecord(entry)) throw new Error('gateway returned an invalid local claim');
    const label = String(entry.label ?? '').trim();
    const kind = String(entry.kind ?? '').trim();
    const attempt = Number(entry.attempt);
    const intervalMinutes = Number(entry.interval_minutes);
    const leaseExpiresAt = String(entry.lease_expires_at ?? '');
    if (
      !label ||
      !kind ||
      entry.runtime !== 'local' ||
      !isRecord(entry.config) ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      !Number.isSafeInteger(intervalMinutes) ||
      intervalMinutes < 1 ||
      !Number.isFinite(Date.parse(leaseExpiresAt))
    ) {
      throw new Error('gateway returned an invalid local claim');
    }
    return {
      run_id: requiredUuid(entry, 'run_id'),
      claim_token: requiredUuid(entry, 'claim_token'),
      job_id: requiredUuid(entry, 'job_id'),
      label,
      kind,
      interval_minutes: intervalMinutes,
      runtime: 'local',
      config: entry.config,
      attempt,
      lease_expires_at: leaseExpiresAt,
    };
  });
}

async function retryGateway(
  config: CliConfig,
  op: string,
  args: Record<string, unknown>,
  dependencies: RunDependencies
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await dependencies.gateway(config, op, args);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function claimOne(
  config: CliConfig,
  workerId: string,
  jobId: string | undefined,
  dependencies: RunDependencies
): Promise<GatewayJob | null> {
  const args: Record<string, unknown> = { worker_id: workerId, limit: 1 };
  if (jobId) args.job_id = jobId;
  const payload = await retryGateway(config, 'jobs.claim_local', args, dependencies);
  return parseClaimedJobs(payload)[0] ?? null;
}

async function runReadback(
  config: CliConfig,
  runId: string,
  dependencies: RunDependencies
): Promise<RunReadback | null> {
  const payload = await dependencies.gateway(config, 'runs.list', { limit: 50 });
  if (!isRecord(payload) || !Array.isArray(payload.runs)) {
    throw new Error('gateway returned an invalid runs response');
  }
  const row = payload.runs.find((candidate) => isRecord(candidate) && candidate.id === runId);
  if (!isRecord(row)) return null;
  return {
    id: String(row.id),
    status: String(row.status ?? ''),
    stats: isRecord(row.stats) ? (row.stats as RunCommitStats) : undefined,
    error: typeof row.error === 'string' ? row.error : undefined,
  };
}

async function renewLease(
  config: CliConfig,
  job: GatewayJob,
  dependencies: RunDependencies
): Promise<void> {
  try {
    const response = await retryGateway(
      config,
      'runs.renew',
      { run_id: job.run_id, claim_token: job.claim_token },
      dependencies
    );
    if (
      !isRecord(response) ||
      typeof response.lease_expires_at !== 'string' ||
      !Number.isFinite(Date.parse(response.lease_expires_at))
    ) {
      throw new Error('gateway returned an invalid lease-renewal response');
    }
  } catch {
    // A transport error may have happened after the renewal committed. Do not
    // turn that ambiguity into a contradictory terminal failure.
    throw new LeaseRenewalUnconfirmedError();
  }
}

interface LeaseHeartbeat {
  checkpoint(): void;
  stop(): Promise<void>;
}

async function startLeaseHeartbeat(
  config: CliConfig,
  job: GatewayJob,
  dependencies: RunDependencies
): Promise<LeaseHeartbeat> {
  // Validate the claim immediately; the interval then covers slow connector
  // and model requests rather than assuming the original 15-minute lease.
  await renewLease(config, job, dependencies);

  let heartbeatError: unknown;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight || heartbeatError) return;
    inFlight = renewLease(config, job, dependencies)
      .catch((error) => {
        heartbeatError = error;
      })
      .finally(() => {
        inFlight = null;
      });
  }, LEASE_HEARTBEAT_MS);
  timer.unref?.();

  return {
    checkpoint() {
      if (heartbeatError) {
        throw heartbeatError;
      }
    },
    async stop() {
      clearInterval(timer);
      if (inFlight) await inFlight;
      if (heartbeatError) {
        throw heartbeatError;
      }
    },
  };
}

function verifiedSource(config: CliConfig, provider: string) {
  return (
    config.connectors.find(
      (connector) => connector.provider === provider && connector.verified === true
    ) ?? null
  );
}

function assertVerifiedSource(config: CliConfig, dependencies: RunDependencies): void {
  const unverified = config.connectors.filter(
    (connector) => LOCAL_SOURCE_PROVIDERS.has(connector.provider) && !connector.verified
  );
  for (const connector of unverified) {
    dependencies.warn(`${connector.provider}: ignored because its credential is not verified`);
  }
  if (
    !config.connectors.some(
      (connector) => LOCAL_SOURCE_PROVIDERS.has(connector.provider) && connector.verified
    )
  ) {
    // A connection configured in the browser stays in the workspace and is
    // never readable here, so the refusal has to name the command that fixes
    // it rather than restate the state the operator is already stuck in.
    throw new Error(
      'run `postshow init` on this machine to enter a PostHog, Stripe, Sentry, GitHub, or Postgres credential; local runs gather from this device and a workspace connection never supplies one'
    );
  }
}

function warnIncompleteGather(
  provider: string,
  value: GatherCompleteness,
  dependencies: RunDependencies
): void {
  if (value.complete) return;
  const state = value.sampled ? 'sampled' : 'partial';
  dependencies.warn(
    `  ${provider}: ${state} source coverage${value.reason ? ` (${value.reason})` : ''}`
  );
}

async function reportFailedRun(
  config: CliConfig,
  job: GatewayJob,
  taskClass: TaskClass,
  phase: Exclude<JobRunPhase, 'complete'>,
  detail: string,
  dependencies: RunDependencies
): Promise<boolean> {
  const args = {
    run_id: job.run_id,
    claim_token: job.claim_token,
    task_class: taskClass,
    status: 'error',
    error: remoteFailureDetail(detail),
    log: [{ phase, level: 'error', message: 'local run failed' }],
  };
  try {
    const response = await retryGateway(config, 'runs.submit', args, dependencies);
    if (!isRecord(response) || response.run_id !== job.run_id || response.status !== 'error') {
      throw new Error('gateway returned an invalid run-failure response');
    }
    return true;
  } catch {
    try {
      return (await runReadback(config, job.run_id, dependencies))?.status === 'error';
    } catch {
      return false;
    }
  }
}

async function failedJob(
  config: CliConfig,
  job: GatewayJob,
  taskClass: TaskClass,
  phase: Exclude<JobRunPhase, 'complete'>,
  error: unknown,
  dependencies: RunDependencies
): Promise<JobRunResult> {
  const detail = errorDetail(error);
  dependencies.fail(`${job.label}: ${detail}`);
  const failureReported = await reportFailedRun(
    config,
    job,
    taskClass,
    phase,
    detail,
    dependencies
  );
  if (!failureReported) {
    dependencies.warn(
      `${job.label}: the workspace did not confirm the failure; this claim will be recovered`
    );
  }
  return {
    jobId: job.job_id,
    runId: job.run_id,
    label: job.label,
    status: 'failed',
    phase,
    detail,
    failureReported,
  };
}

type CommitResult =
  | { state: 'ok'; stats: RunCommitStats }
  | { state: 'error'; detail: string }
  | { state: 'unknown'; detail: string };

async function submitSuccessfulRun(
  config: CliConfig,
  job: GatewayJob,
  payload: Record<string, unknown>,
  dependencies: RunDependencies
): Promise<CommitResult> {
  try {
    const response = await retryGateway(config, 'runs.submit', payload, dependencies);
    if (!isRecord(response) || response.run_id !== job.run_id || !isRecord(response.stats)) {
      throw new Error('gateway returned an invalid run-commit response');
    }
    return { state: 'ok', stats: response.stats as RunCommitStats };
  } catch (submitError) {
    try {
      const readback = await runReadback(config, job.run_id, dependencies);
      if (readback?.status === 'ok') return { state: 'ok', stats: readback.stats ?? {} };
      if (readback?.status === 'error') {
        return { state: 'error', detail: readback.error || 'workspace recorded the run as failed' };
      }
    } catch {
      // The result remains unknown. Never overwrite a possibly successful
      // commit with a contradictory error submission.
    }
    return {
      state: 'unknown',
      detail: `the workspace did not confirm the run commit: ${errorDetail(submitError)}`,
    };
  }
}

function boundedCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function commitDetail(stats: RunCommitStats): string {
  return `${boundedCount(stats.items)} draft(s), ${boundedCount(stats.notes)} field note(s) synced`;
}

export async function executeLocalJob(
  config: CliConfig,
  job: GatewayJob,
  dependencies: RunDependencies = runDependencies
): Promise<JobRunResult> {
  dependencies.say(`running: ${job.label}`);
  const taskClass = taskClassForJobKind(job.kind);
  let phase: Exclude<JobRunPhase, 'complete'> = 'preflight';
  let heartbeat: LeaseHeartbeat | null = null;

  try {
    assertVerifiedSource(config, dependencies);
    const engine = resolveTaskEngine(taskClass, config.engine, config.taskPrefs);
    if (engine.mode === 'hosted') {
      throw new Error(
        'this local job resolves to the hosted engine; choose a BYOK or local engine'
      );
    }
    const apiKey = config.keys[engine.provider] ?? '';
    heartbeat = await startLeaseHeartbeat(config, job, dependencies);

    phase = 'gather';
    const windowDays = job.kind === 'deep_dive' ? 7 : 1;
    let posthog: PosthogGather | null = null;
    let stripe: GatherResult<StripeAccount[]> | null = null;
    let sentry: SentryGather | null = null;
    let github: GithubGather | null = null;
    let postgresSnapshot: PostgresSnapshot | null = null;
    let sessionsWatched = 0;

    const gatherers: { provider: string; gather: () => Promise<void> }[] = [];
    const ph = verifiedSource(config, 'posthog');
    if (ph) {
      gatherers.push({
        provider: 'posthog',
        gather: async () => {
          posthog = await dependencies.posthogGather(ph.meta, ph.secret, windowDays);
          sessionsWatched = posthog.samples.length;
          dependencies.dim(`  posthog: ${posthog.samples.length} session samples`);
          warnIncompleteGather('posthog', posthog.completeness, dependencies);
        },
      });
    }
    const st = verifiedSource(config, 'stripe');
    if (st) {
      gatherers.push({
        provider: 'stripe',
        gather: async () => {
          stripe = await dependencies.stripeGather(st.secret);
          dependencies.dim(`  stripe: ${stripe.data.length} subscriptions`);
          warnIncompleteGather('stripe', stripe.completeness, dependencies);
        },
      });
    }
    const se = verifiedSource(config, 'sentry');
    if (se) {
      gatherers.push({
        provider: 'sentry',
        gather: async () => {
          sentry = await dependencies.sentryGather(se.meta, se.secret, windowDays);
          dependencies.dim(`  sentry: ${sentry.data.length} issues`);
          warnIncompleteGather('sentry', sentry.completeness, dependencies);
        },
      });
    }
    const gh = verifiedSource(config, 'github');
    if (gh) {
      gatherers.push({
        provider: 'github',
        gather: async () => {
          github = await dependencies.githubGather(gh.meta, gh.secret, windowDays);
          dependencies.dim(
            `  github: ${github.data.length} merged PRs, ${github.objects.length} citable objects`
          );
          warnIncompleteGather('github', github.completeness, dependencies);
        },
      });
    }
    const pg = verifiedSource(config, 'postgres');
    if (pg) {
      gatherers.push({
        provider: 'postgres',
        gather: async () => {
          postgresSnapshot = await dependencies.postgresGather(pg.secret);
          dependencies.dim(`  postgres: ${postgresSnapshot.rows.length} row(s)`);
          warnIncompleteGather('postgres', postgresSnapshot.completeness, dependencies);
        },
      });
    }
    const gathered = await Promise.allSettled(gatherers.map((source) => source.gather()));
    let successfulSources = 0;
    const failedEvidenceSources = new Set<string>();
    for (const [index, result] of gathered.entries()) {
      if (result.status === 'fulfilled') successfulSources += 1;
      else {
        failedEvidenceSources.add(gatherers[index]!.provider);
        dependencies.warn(
          `  ${gatherers[index]!.provider}: gather failed (${errorDetail(result.reason)})`
        );
      }
    }
    heartbeat.checkpoint();
    if (successfulSources === 0) {
      throw new Error(
        'every verified source connector failed to gather; no analysis was submitted'
      );
    }

    phase = 'context';
    const [workspaceInfo, scratchpadInfo, findingsInfo, approvedInfo, skippedInfo] =
      (await Promise.all([
        dependencies.gateway(config, 'workspace.get'),
        dependencies.gateway(config, 'scratchpad.list'),
        dependencies.gateway(config, 'findings.list'),
        dependencies.gateway(config, 'inbox.list', { state: 'approved', limit: 50 }),
        dependencies.gateway(config, 'inbox.list', { state: 'skipped', limit: 50 }),
      ])) as [
        { workspace: { agent_rules: string[] } },
        { scratchpad: { key: string; content: string }[] },
        { fingerprints: string[] },
        { items: { title: string }[] },
        { items: { title: string }[] },
      ];
    heartbeat.checkpoint();
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
      sections: [
        ...packetSections({ posthog, stripe, sentry, github }),
        ...(postgresSnapshot ? [dependencies.postgresPacketSection(postgresSnapshot)] : []),
      ],
    });

    phase = 'model';
    const result = await dependencies.callModel(engine, apiKey, {
      system: agentSystemPrompt(taskClass),
      prompt: packet,
      maxTokens: taskClass === 'deep_dive' ? 8000 : 4000,
    });
    heartbeat.checkpoint();

    phase = 'parse';
    // The model is an untrusted boundary. Sanitize before the Postshow call so
    // unknown keys cannot reach the gateway or workspace storage; the gateway
    // repeats this sanitization as defense in depth.
    const gatheredPosthog = posthog as PosthogGather | null;
    const gatheredStripe = stripe as GatherResult<StripeAccount[]> | null;
    const gatheredSentry = sentry as SentryGather | null;
    const gatheredGithub = github as GithubGather | null;
    const sourceAccounts = stripeSourceAccounts(gatheredStripe);
    const identityContext = sourceIdentityContext(gatheredPosthog, gatheredStripe);
    const evidenceContext = sourceEvidenceContext({
      posthog: failedEvidenceSources.has('posthog') ? 'failed' : gatheredPosthog?.completeness,
      stripe: failedEvidenceSources.has('stripe') ? 'failed' : gatheredStripe?.completeness,
      sentry: failedEvidenceSources.has('sentry') ? 'failed' : gatheredSentry?.completeness,
      github: failedEvidenceSources.has('github') ? 'failed' : gatheredGithub?.completeness,
    });
    const output = sanitizeModelOutput(dependencies.parseModelJson(result.text), {
      allowedSessionIds: gatheredPosthog?.samples.map((sample) => sample.sid) ?? [],
      allowedAccountIdentityKeys: sourceAccounts.map((account) => account.identityKey),
      allowedSentryIssueIds: gatheredSentry?.data.map((issue) => issue.id) ?? [],
      allowedGithubObjectRefs:
        gatheredGithub?.objects.map((object) => `${object.type}:${object.id}`) ?? [],
      sessionAccountIdentityKeys: identityContext.sessions.map(
        (session) => [session.sessionId, session.accountIdentityKey] as const
      ),
    });
    heartbeat.checkpoint();

    phase = 'submit';
    await heartbeat.stop();
    heartbeat = null;
    const engineLabel = `${engine.mode}/${engine.provider}/${engine.model}`.slice(0, 240);
    const commit = await submitSuccessfulRun(
      config,
      job,
      {
        run_id: job.run_id,
        claim_token: job.claim_token,
        task_class: taskClass,
        status: 'ok',
        output,
        source_accounts: sourceAccounts,
        source_session_ids: gatheredPosthog?.samples.map((sample) => sample.sid) ?? [],
        identity_context: identityContext,
        evidence_context: evidenceContext,
        // The set of Sentry issues this run actually collected, with the
        // connection and window that produced it. Without it the workspace has
        // nothing to revalidate a cited `sentry_issue_id` against and has to
        // trust this machine. Only the provider identifier and the timestamps
        // that place it inside the window travel; issue titles and permalinks
        // are provider-authored text and stay on this device.
        sentry_source:
          gatheredSentry && se
            ? {
                orgSlug: String(se.meta.org_slug ?? ''),
                projectSlug: String(se.meta.project_slug ?? ''),
                window: gatheredSentry.window,
                issues: gatheredSentry.data.map((issue) => ({
                  id: issue.id,
                  lastSeen: issue.lastSeen,
                })),
              }
            : null,
        // The same bargain as `sentry_source`, for code context: the repository
        // objects this run actually collected, with the window that produced
        // them, so the workspace can revalidate a cited object instead of
        // trusting this machine. Titles and URLs stay on this device; the
        // gateway rebuilds links from the repository it has on file.
        github_source:
          gatheredGithub && gh
            ? {
                repo: gatheredGithub.repo,
                window: gatheredGithub.window,
                objects: gatheredGithub.objects.map((object) => ({
                  type: object.type,
                  id: object.id,
                  lastSeen: object.lastSeen,
                })),
              }
            : null,
        engine: engineLabel,
        sessions_watched: sessionsWatched,
        usage: {
          provider: engine.provider,
          model: engine.model,
          mode: engine.mode,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
        },
        log: [{ phase: 'complete', level: 'info', message: 'local run completed' }],
      },
      dependencies
    );
    if (commit.state !== 'ok') {
      dependencies.fail(`${job.label}: ${commit.detail}`);
      return {
        jobId: job.job_id,
        runId: job.run_id,
        label: job.label,
        status: commit.state === 'unknown' ? 'uncertain' : 'failed',
        phase: 'submit',
        detail: commit.detail,
        failureReported: commit.state === 'error',
      };
    }
    const detail = commitDetail(commit.stats);
    dependencies.ok(`${job.label}: ${detail}`);
    return {
      jobId: job.job_id,
      runId: job.run_id,
      label: job.label,
      status: 'succeeded',
      phase: 'complete',
      detail,
      failureReported: false,
    };
  } catch (error) {
    if (heartbeat) {
      try {
        await heartbeat.stop();
      } catch (heartbeatError) {
        error = heartbeatError;
      }
    }
    if (error instanceof LeaseRenewalUnconfirmedError) {
      const detail = error.message;
      dependencies.fail(`${job.label}: ${detail}`);
      dependencies.warn(`${job.label}: no terminal result was submitted for an uncertain lease`);
      return {
        jobId: job.job_id,
        runId: job.run_id,
        label: job.label,
        status: 'uncertain',
        phase,
        detail,
        failureReported: false,
      };
    }
    return await failedJob(config, job, taskClass, phase, error, dependencies);
  }
}

function aggregateResults(results: JobRunResult[]): RunSummary {
  const succeeded = results.filter((result) => result.status === 'succeeded').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const uncertain = results.filter((result) => result.status === 'uncertain').length;
  return {
    status:
      failed === 0 && uncertain === 0
        ? 'succeeded'
        : failed === 0 && succeeded === 0
          ? 'uncertain'
          : succeeded === 0
            ? 'failed'
            : 'partial',
    exitCode: failed === 0 && uncertain === 0 ? 0 : 1,
    succeeded,
    failed,
    uncertain,
    jobs: results,
  };
}

function topLevelFailure(
  phase: 'configuration' | 'discovery' | 'concurrency',
  detail: string,
  dependencies: RunDependencies
): RunSummary {
  dependencies.fail(detail);
  return {
    status: 'failed',
    exitCode: 1,
    succeeded: 0,
    failed: 0,
    uncertain: 0,
    jobs: [],
    error: { phase, detail },
  };
}

function discoveryAfterResults(
  results: JobRunResult[],
  detail: string,
  dependencies: RunDependencies
): RunSummary {
  dependencies.fail(detail);
  const summary = aggregateResults(results);
  return {
    ...summary,
    status: summary.succeeded > 0 ? 'partial' : 'failed',
    exitCode: 1,
    error: { phase: 'discovery', detail },
  };
}

/** Claim and execute local jobs serially. `surface` is part of both the
 * stable worker identity and the local exclusivity lock. */
export async function runOnceDetailed(
  jobId?: string,
  dependencies: RunDependencies = runDependencies,
  surface: WorkerSurface = 'cli'
): Promise<RunSummary> {
  let config: CliConfig;
  try {
    config = dependencies.loadConfig();
  } catch (error) {
    return topLevelFailure('configuration', errorDetail(error), dependencies);
  }
  if (!config.token) {
    return topLevelFailure(
      'configuration',
      'no access token; run `postshow init` first',
      dependencies
    );
  }

  let releaseLock: (() => void) | null = null;
  let workerId: string;
  try {
    releaseLock = dependencies.acquireWorkerLock(surface);
    workerId = dependencies.localWorkerId(surface);
  } catch (error) {
    releaseLock?.();
    const phase = error instanceof WorkerBusyError ? 'concurrency' : 'configuration';
    return topLevelFailure(phase, errorDetail(error), dependencies);
  }

  const results: JobRunResult[] = [];
  const seenRuns = new Set<string>();
  try {
    while (results.length < MAX_LOCAL_JOBS_PER_RUN) {
      let claimed: GatewayJob | null;
      try {
        claimed = await claimOne(config, workerId, jobId, dependencies);
      } catch (error) {
        const detail = errorDetail(error);
        return results.length
          ? discoveryAfterResults(results, detail, dependencies)
          : topLevelFailure('discovery', detail, dependencies);
      }

      if (!claimed) {
        if (jobId && results.length === 0) {
          return topLevelFailure(
            'discovery',
            `job is unavailable or not routed to this local worker: ${jobId}`,
            dependencies
          );
        }
        break;
      }
      if (seenRuns.has(claimed.run_id)) {
        dependencies.warn(`${claimed.label}: the live claim is awaiting recovery; stopping here`);
        break;
      }
      seenRuns.add(claimed.run_id);

      const result = await executeLocalJob(config, claimed, dependencies);
      results.push(result);
      if (
        jobId ||
        result.status === 'uncertain' ||
        (result.status === 'failed' && !result.failureReported)
      ) {
        break;
      }
    }
  } finally {
    releaseLock();
  }

  if (!results.length) {
    dependencies.dim('nothing due. jobs marked "runs locally" appear here when their time comes.');
    return { status: 'idle', exitCode: 0, succeeded: 0, failed: 0, uncertain: 0, jobs: [] };
  }
  if (!jobId && results.length === MAX_LOCAL_JOBS_PER_RUN) {
    dependencies.dim(
      `processed ${MAX_LOCAL_JOBS_PER_RUN} local jobs; any remaining due work will be claimed on the next heartbeat`
    );
  }
  return aggregateResults(results);
}

export async function runOnce(
  jobId?: string,
  dependencies: RunDependencies = runDependencies,
  surface: WorkerSurface = 'cli'
): Promise<number> {
  return (await runOnceDetailed(jobId, dependencies, surface)).exitCode;
}

const MIN_WATCH_INTERVAL_MINUTES = 5;
const MAX_WATCH_INTERVAL_MINUTES = 24 * 60;

export function validatedWatchInterval(intervalMinutes: number): number {
  if (
    !Number.isFinite(intervalMinutes) ||
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < MIN_WATCH_INTERVAL_MINUTES ||
    intervalMinutes > MAX_WATCH_INTERVAL_MINUTES
  ) {
    throw new Error('watch interval must be a whole number from 5 to 1440 minutes');
  }
  return intervalMinutes;
}

export async function runWatch(intervalMinutes: number): Promise<number> {
  const interval = validatedWatchInterval(intervalMinutes);
  say(`watching for due local jobs every ${interval} min. ctrl-c to stop.`);
  for (;;) {
    try {
      const summary = await runOnceDetailed(undefined, runDependencies, 'watch');
      if (summary.exitCode !== 0) {
        warn(
          summary.uncertain > 0
            ? `${summary.uncertain} local job outcome(s) are uncertain; live claims will be recovered`
            : summary.failed > 0
              ? `${summary.failed} local job(s) failed; will retry on the next heartbeat`
              : 'local heartbeat failed; will retry'
        );
      }
    } catch (error) {
      warn(error instanceof Error ? error.message : 'heartbeat failed; will retry');
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 60_000));
  }
}
