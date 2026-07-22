import { useCallback, useRef, useState, type FormEvent } from 'react';
import { describeCadence, normalizePlanId } from '@eventools/postshow-core';
import { useWorkspace } from '@/state/WorkspaceContext';
import {
  createJob,
  fetchJobs,
  fetchRuns,
  fetchWorkspacePermissions,
  decideJob,
  runJobNow,
  updateJobCadence,
} from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { clearIdempotencyKey, idempotencyKey } from '@/lib/idempotency';
import { PageHeader, LoadingRow, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import { SOURCE_CLI_COMMAND } from '@/lib/cli';
import type { Job, Run } from '@/lib/types';

const CADENCES: { minutes: number; label: string }[] = [
  { minutes: 60, label: 'hourly' },
  { minutes: 360, label: 'every 6 hours' },
  { minutes: 1440, label: 'daily' },
  { minutes: 10080, label: 'weekly' },
];

function JobRow({
  actorId,
  workspaceId,
  job,
  canOperate,
  isCurrentContext,
  onChanged,
}: {
  actorId: string;
  workspaceId: string;
  job: Job;
  canOperate: boolean;
  isCurrentContext: () => boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showLocalHandoff, setShowLocalHandoff] = useState(false);

  async function decide(action: 'approve' | 'veto' | 'pause' | 'resume') {
    if (busy || !canOperate || job.workspace_id !== workspaceId || !isCurrentContext()) return;
    setBusy(true);
    setError('');
    try {
      await decideJob(job.id, action);
      if (!isCurrentContext()) return;
      track(`job_${action}`);
      onChanged();
    } catch (e) {
      if (isCurrentContext()) {
        setError(e instanceof Error ? e.message : 'Could not update the job.');
      }
    } finally {
      if (isCurrentContext()) setBusy(false);
    }
  }

  async function reschedule(minutes: number) {
    if (busy || !canOperate || job.workspace_id !== workspaceId || !isCurrentContext()) return;
    setBusy(true);
    setError('');
    try {
      await updateJobCadence(job.id, minutes);
      if (!isCurrentContext()) return;
      track('job_cadence_changed', { minutes });
      onChanged();
    } catch (e) {
      if (isCurrentContext()) {
        setError(e instanceof Error ? e.message : 'Could not change the cadence.');
      }
    } finally {
      if (isCurrentContext()) setBusy(false);
    }
  }

  async function runNow() {
    if (busy || !canOperate || !actorId || job.workspace_id !== workspaceId) return;
    const scope = `${actorId}.${workspaceId}.job-run.${job.id}`;
    setBusy(true);
    setError('');
    try {
      await runJobNow(job.id, idempotencyKey(scope));
      clearIdempotencyKey(scope);
      if (!isCurrentContext()) return;
      track('job_run_now');
      onChanged();
    } catch (e) {
      if (isCurrentContext()) {
        setError(e instanceof Error ? e.message : 'Could not start the run.');
      }
    } finally {
      if (isCurrentContext()) setBusy(false);
    }
  }

  const paused = job.status === 'paused';
  const proposed = job.status === 'proposed';

  return (
    <li
      className={[
        'ps-card flex flex-col gap-3 p-5',
        proposed ? 'border-l-2 border-l-signal' : '',
        paused ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {proposed && (
            <p className="m-0 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em] text-signal">
              proposed by postshow
            </p>
          )}
          <h3 className="m-0 mt-1 font-public-sans text-[15px] font-semibold leading-[1.35] text-night-fg">
            {job.label}
          </h3>
          <p className="m-0 mt-1 font-public-mono text-[11px] uppercase tracking-[0.12em] text-night-fg-3">
            {job.schedule_label ||
              describeCadence({
                schedule_cron: job.schedule_cron,
                interval_minutes: job.interval_minutes,
              })}
            {job.runtime === 'local' && ' · runs locally'}
            {paused && ' · paused'}
            {job.last_run_at &&
              ` · last run ${new Date(job.last_run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          </p>
          {proposed && job.proposed_reason && (
            <p className="m-0 mt-2 max-w-[60ch] font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
              {job.proposed_reason}
            </p>
          )}
        </div>
        {canOperate ? (
          <div className="flex shrink-0 gap-2">
            {proposed ? (
              <>
                <button
                  type="button"
                  onClick={() => void decide('approve')}
                  disabled={busy}
                  className="ps-btn-primary"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void decide('veto')}
                  disabled={busy}
                  className="ps-btn-ghost"
                >
                  Veto
                </button>
              </>
            ) : (
              <>
                {job.runtime === 'local' ? (
                  <button
                    type="button"
                    onClick={() => setShowLocalHandoff(true)}
                    disabled={busy || paused}
                    className="ps-btn-primary"
                  >
                    Run on device
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void runNow()}
                    disabled={busy || paused}
                    className="ps-btn-primary"
                  >
                    {busy ? 'Working…' : 'Run now'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void decide(paused ? 'resume' : 'pause')}
                  disabled={busy}
                  className="ps-btn-ghost"
                >
                  {paused ? 'Resume' : 'Pause'}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {!proposed && canOperate ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
            cadence
          </span>
          {CADENCES.map((cadence) => {
            const active = job.interval_minutes === cadence.minutes;
            return (
              <button
                key={cadence.minutes}
                type="button"
                disabled={busy || active}
                onClick={() => void reschedule(cadence.minutes)}
                aria-pressed={active}
                className={[
                  'rounded-sm border px-2 py-0.5 font-public-mono text-[10px] uppercase tracking-[0.1em]',
                  active
                    ? 'border-signal text-signal'
                    : 'border-night-4 text-night-fg-3 hover:text-night-fg',
                ].join(' ')}
              >
                {cadence.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {showLocalHandoff ? (
        <div className="rounded-sm border border-signal/30 bg-night-2 p-3" role="status">
          <p className="m-0 font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
            Local jobs must be claimed by the authenticated device that holds the source
            credentials. Run:
          </p>
          <code className="mt-2 block break-all font-public-mono text-[11px] text-night-fg">
            {SOURCE_CLI_COMMAND} run --job {job.id}
          </code>
          <button
            type="button"
            onClick={() => setShowLocalHandoff(false)}
            className="ps-btn-ghost mt-2"
          >
            Close
          </button>
        </div>
      ) : null}
      {error && <ErrorRow message={error} />}
    </li>
  );
}

function RunRow({ run }: { run: Run }) {
  const statusClass =
    run.status === 'ok' ? 'text-signal' : run.status === 'error' ? 'text-bad' : 'text-warn';
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-night-3 pb-2">
      <span className="min-w-0 truncate font-public-sans text-[13px] text-night-fg-2">
        {run.summary || (run.status === 'running' ? 'Running…' : run.error || 'Run')}
      </span>
      <span
        className={`shrink-0 font-public-mono text-[10px] uppercase tracking-[0.12em] ${statusClass}`}
      >
        {run.status} ·{' '}
        {new Date(run.started_at).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </li>
  );
}

function NewInvestigation({
  workspaceId,
  planId,
  isCurrentContext,
  onCreated,
}: {
  workspaceId: string;
  planId: string;
  isCurrentContext: () => boolean;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [question, setQuestion] = useState('');
  const [minutes, setMinutes] = useState(1440);
  const [runtime, setRuntime] = useState<'cloud' | 'local'>(() =>
    normalizePlanId(planId) === 'free' ? 'local' : 'cloud'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !label.trim() || !isCurrentContext()) return;
    setBusy(true);
    setError('');
    try {
      await createJob({
        workspaceId,
        label: label.trim(),
        question,
        intervalMinutes: minutes,
        runtime,
      });
      if (!isCurrentContext()) return;
      track('job_created', { minutes, runtime });
      setLabel('');
      setQuestion('');
      setOpen(false);
      onCreated();
    } catch (e) {
      if (isCurrentContext()) {
        setError(e instanceof Error ? e.message : 'Could not create the investigation.');
      }
    } finally {
      if (isCurrentContext()) setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ps-btn-ghost mb-4 w-fit">
        + Standing investigation
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="ps-card mb-4 flex flex-col gap-3 p-5">
      <label className="flex flex-col gap-1">
        <span className="ps-label">What should the agent keep watching?</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="ps-input"
          placeholder="Why do trials from paid ads stall at onboarding?"
          autoFocus
        />
      </label>
      <label className="flex max-w-[320px] flex-col gap-1">
        <span className="ps-label">Where it runs</span>
        <select
          value={runtime}
          onChange={(event) => setRuntime(event.target.value as 'cloud' | 'local')}
          className="ps-input"
        >
          {normalizePlanId(planId) !== 'free' ? (
            <option value="cloud">Postshow cloud</option>
          ) : null}
          <option value="local">My authenticated device</option>
        </select>
        <span className="font-public-sans text-[11px] leading-[1.45] text-night-fg-3">
          {runtime === 'local'
            ? 'The job is claimed by your CLI or desktop agent; the browser never receives device credentials.'
            : 'Postshow runs the job with verified cloud connectors and your plan quota.'}
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="ps-label">Extra context (optional)</span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="ps-input"
          placeholder="Compare against organic signups; ignore the QA org."
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {CADENCES.map((cadence) => (
          <button
            key={cadence.minutes}
            type="button"
            onClick={() => setMinutes(cadence.minutes)}
            aria-pressed={minutes === cadence.minutes}
            className={[
              'rounded-sm border px-2 py-1 font-public-mono text-[10px] uppercase tracking-[0.1em]',
              minutes === cadence.minutes
                ? 'border-signal text-signal'
                : 'border-night-4 text-night-fg-3 hover:text-night-fg',
            ].join(' ')}
          >
            {cadence.label}
          </button>
        ))}
      </div>
      {error && <ErrorRow message={error} />}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !label.trim()} className="ps-btn-primary">
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="ps-btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function WorkPlanPage() {
  const { session, workspace } = useWorkspace();
  const actorId = session?.user.id ?? '';
  const workspaceId = workspace?.id ?? '';
  const context = `${actorId}:${workspaceId}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const jobsFetcher = useCallback(() => fetchJobs(workspaceId), [workspaceId]);
  const runsFetcher = useCallback(() => fetchRuns(workspaceId), [workspaceId]);
  const permissionsFetcher = useCallback(
    () => fetchWorkspacePermissions(workspaceId),
    [workspaceId]
  );
  const jobs = usePageData(jobsFetcher);
  const runs = usePageData(runsFetcher);
  const permissions = usePageData(permissionsFetcher);
  const permissionsReady =
    !permissions.loading && !permissions.error && permissions.data?.workspace_id === workspaceId;
  const canOperate =
    permissionsReady && permissions.data !== null && permissions.data.operate === true;

  const reloadAll = useCallback(() => {
    jobs.reload();
    runs.reload();
  }, [jobs, runs]);

  return (
    <div>
      <PageHeader
        title="Work plan"
        sub="The agent schedules its own work. You hold the veto, and every run is on the record."
      />
      {canOperate ? (
        <NewInvestigation
          key={`${actorId}:${workspaceId}`}
          workspaceId={workspaceId}
          planId={workspace?.plan ?? 'free'}
          isCurrentContext={() => currentContext.current === context}
          onCreated={reloadAll}
        />
      ) : null}
      {permissions.loading ? (
        <p className="mb-4 font-public-sans text-[12px] text-night-fg-3" role="status">
          Checking work-plan permissions… Controls remain locked.
        </p>
      ) : permissions.error ? (
        <div className="mb-4 flex flex-wrap items-center gap-3" role="alert">
          <span className="font-public-sans text-[12px] text-bad">
            Workspace permissions could not be verified. Work-plan controls remain locked.
          </span>
          <button type="button" onClick={permissions.reload} className="ps-btn-ghost">
            Retry permission check
          </button>
        </div>
      ) : permissionsReady && !canOperate ? (
        <p className="mb-4 font-public-sans text-[12px] text-night-fg-2">
          The work plan is read-only for your workspace role.
        </p>
      ) : null}
      {jobs.loading && <LoadingRow />}
      {jobs.error && <ErrorRow message={jobs.error} />}
      {(jobs.data ?? []).length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(jobs.data ?? []).map((job) => (
            <JobRow
              key={`${actorId}:${workspaceId}:${job.id}`}
              actorId={actorId}
              workspaceId={workspaceId}
              job={job}
              canOperate={canOperate}
              isCurrentContext={() => currentContext.current === context}
              onChanged={reloadAll}
            />
          ))}
        </ul>
      )}
      {(runs.data ?? []).length > 0 && (
        <Section title="Recent runs">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(runs.data ?? []).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
