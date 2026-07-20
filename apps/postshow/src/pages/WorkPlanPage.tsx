import { useCallback, useState, type FormEvent } from 'react';
import { describeCadence } from '@eventools/postshow-core';
import { useWorkspace } from '@/state/WorkspaceContext';
import { createJob, fetchJobs, fetchRuns, decideJob, runJobNow, updateJobCadence } from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { PageHeader, LoadingRow, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import type { Job, Run } from '@/lib/types';

const CADENCES: { minutes: number; label: string }[] = [
  { minutes: 60, label: 'hourly' },
  { minutes: 360, label: 'every 6 hours' },
  { minutes: 1440, label: 'daily' },
  { minutes: 10080, label: 'weekly' },
];

function JobRow({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(action: 'approve' | 'veto' | 'pause' | 'resume') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await decideJob(job.id, action);
      track(`job_${action}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the job.');
      setBusy(false);
    }
  }

  async function reschedule(minutes: number) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await updateJobCadence(job.id, minutes);
      track('job_cadence_changed', { minutes });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the cadence.');
      setBusy(false);
    }
  }

  async function runNow() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await runJobNow(job.id);
      if (!result.ok) throw new Error(result.detail || 'The run failed to start.');
      track('job_run_now');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run.');
    } finally {
      setBusy(false);
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
              <button
                type="button"
                onClick={() => void runNow()}
                disabled={busy || paused}
                className="ps-btn-primary"
              >
                {busy ? 'Working…' : 'Run now'}
              </button>
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
      </div>
      {!proposed && (
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
      )}
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
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [question, setQuestion] = useState('');
  const [minutes, setMinutes] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !label.trim()) return;
    setBusy(true);
    setError('');
    try {
      await createJob({ workspaceId, label: label.trim(), question, intervalMinutes: minutes });
      track('job_created', { minutes });
      setLabel('');
      setQuestion('');
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the investigation.');
    } finally {
      setBusy(false);
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
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const jobsFetcher = useCallback(() => fetchJobs(workspaceId), [workspaceId]);
  const runsFetcher = useCallback(() => fetchRuns(workspaceId), [workspaceId]);
  const jobs = usePageData(jobsFetcher);
  const runs = usePageData(runsFetcher);

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
      <NewInvestigation workspaceId={workspaceId} onCreated={reloadAll} />
      {jobs.loading && <LoadingRow />}
      {jobs.error && <ErrorRow message={jobs.error} />}
      {(jobs.data ?? []).length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(jobs.data ?? []).map((job) => (
            <JobRow key={job.id} job={job} onChanged={reloadAll} />
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
