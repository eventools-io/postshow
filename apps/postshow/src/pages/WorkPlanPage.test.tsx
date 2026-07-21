import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkPlanPage } from './WorkPlanPage';
import { createJob, fetchJobs, fetchRuns, fetchWorkspacePermissions, runJobNow } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { Job, WorkspacePermissions } from '@/lib/types';

const context = vi.hoisted(() => ({
  actorId: '00000000-0000-4000-8000-000000000010',
  workspace: {
    id: '00000000-0000-4000-8000-000000000001',
    plan: 'free',
  },
}));
vi.mock('@/state/WorkspaceContext', () => ({
  useWorkspace: () => ({
    session: { user: { id: context.actorId } },
    workspace: context.workspace,
  }),
}));
vi.mock('@/lib/api', () => ({
  createJob: vi.fn(),
  fetchJobs: vi.fn(),
  fetchRuns: vi.fn(),
  fetchWorkspacePermissions: vi.fn(),
  decideJob: vi.fn(),
  runJobNow: vi.fn(),
  updateJobCadence: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const jobs = vi.mocked(fetchJobs);
const runs = vi.mocked(fetchRuns);
const fetchPermissions = vi.mocked(fetchWorkspacePermissions);
const create = vi.mocked(createJob);
const runNow = vi.mocked(runJobNow);
const analytics = vi.mocked(track);
const workspaceA = '00000000-0000-4000-8000-000000000001';
const workspaceB = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000101';
const runId = '00000000-0000-4000-8000-000000000201';

function permissions(workspaceId: string, operate = true): WorkspacePermissions {
  return {
    workspace_id: workspaceId,
    manage_settings: false,
    manage_members: false,
    manage_billing: false,
    delete_workspace: false,
    operate,
    approve_actions: false,
  };
}

function cloudJob(workspaceId = context.workspace.id, overrides: Partial<Job> = {}): Job {
  return {
    id: jobId,
    workspace_id: workspaceId,
    label: `Cloud watcher ${workspaceId.slice(-1)}`,
    kind: 'custom',
    schedule_cron: null,
    interval_minutes: 1440,
    runtime: 'cloud',
    schedule_label: 'Daily',
    status: 'active',
    proposed_reason: '',
    created_by: 'user',
    last_run_at: null,
    created_at: '2026-07-21T00:00:00Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WorkPlanPage runtime contracts', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    context.actorId = '00000000-0000-4000-8000-000000000010';
    context.workspace.id = workspaceA;
    context.workspace.plan = 'free';
    jobs.mockReset().mockResolvedValue([]);
    runs.mockReset().mockResolvedValue([]);
    fetchPermissions
      .mockReset()
      .mockImplementation(async (workspaceId) => permissions(workspaceId));
    create.mockReset().mockResolvedValue(undefined);
    runNow.mockReset();
    analytics.mockReset();
  });

  it('creates free-plan investigations on an authenticated local runner', async () => {
    const user = userEvent.setup();
    render(<WorkPlanPage />);
    await user.click(await screen.findByRole('button', { name: /standing investigation/i }));
    expect(screen.getByRole('combobox', { name: /where it runs/i })).toHaveValue('local');
    expect(screen.queryByRole('option', { name: /postshow cloud/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/what should the agent keep watching/i), 'Watch churn');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        workspaceId: workspaceA,
        label: 'Watch churn',
        question: '',
        intervalMinutes: 1440,
        runtime: 'local',
      })
    );
  });

  it('hands local run-now to the device instead of invoking the cloud worker', async () => {
    jobs.mockResolvedValue([
      {
        id: 'job-local-1',
        workspace_id: workspaceA,
        label: 'Local watcher',
        kind: 'custom',
        schedule_cron: null,
        interval_minutes: 1440,
        runtime: 'local',
        schedule_label: 'Daily',
        status: 'active',
        proposed_reason: '',
        created_by: 'user',
        last_run_at: null,
        created_at: '2026-07-21T00:00:00Z',
      },
    ]);
    const user = userEvent.setup();
    render(<WorkPlanPage />);
    await user.click(await screen.findByRole('button', { name: /run on device/i }));

    expect(runNow).not.toHaveBeenCalled();
    expect(screen.getByText(/npx postshow run --job job-local-1/i)).toBeInTheDocument();
  });

  it('reuses one actor/workspace/job request UUID after a lost response and clears it only on success', async () => {
    jobs.mockResolvedValue([cloudJob()]);
    runNow
      .mockRejectedValueOnce(new Error('The response was lost.'))
      .mockResolvedValueOnce({ ok: true, run_id: runId, status: 'running' });
    const user = userEvent.setup();
    render(<WorkPlanPage />);

    await user.click(await screen.findByRole('button', { name: /^run now$/i }));
    expect(await screen.findByText(/response was lost/i)).toBeInTheDocument();
    const firstRequestId = runNow.mock.calls[0]?.[1];
    expect(firstRequestId).toMatch(/^[0-9a-f-]{36}$/i);

    await user.click(screen.getByRole('button', { name: /^run now$/i }));
    await waitFor(() => expect(runNow).toHaveBeenCalledTimes(2));
    expect(runNow).toHaveBeenNthCalledWith(1, jobId, firstRequestId);
    expect(runNow).toHaveBeenNthCalledWith(2, jobId, firstRequestId);
    expect(
      window.sessionStorage.getItem(
        `postshow.operation.${context.actorId}.${workspaceA}.job-run.${jobId}`
      )
    ).toBeNull();
  });

  it('fences a late authoritative run response after switching workspaces', async () => {
    const pending = deferred<Awaited<ReturnType<typeof runJobNow>>>();
    jobs.mockImplementation(async (workspaceId) => [cloudJob(workspaceId)]);
    runNow.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    const view = render(<WorkPlanPage />);

    await user.click(await screen.findByRole('button', { name: /^run now$/i }));
    context.workspace.id = workspaceB;
    view.rerender(<WorkPlanPage />);
    expect(await screen.findByText(`Cloud watcher ${workspaceB.slice(-1)}`)).toBeInTheDocument();

    await act(async () => {
      pending.resolve({ ok: true, run_id: runId, status: 'running' });
      await pending.promise;
    });
    await Promise.resolve();

    expect(jobs.mock.calls.filter(([id]) => id === workspaceA)).toHaveLength(1);
    expect(jobs.mock.calls.filter(([id]) => id === workspaceB)).toHaveLength(1);
    expect(analytics).not.toHaveBeenCalledWith('job_run_now');
    expect(screen.getByRole('button', { name: /^run now$/i })).toBeEnabled();
  });

  it.each(['owner', 'admin', 'member'])('allows %s work-plan operations', async () => {
    jobs.mockResolvedValue([cloudJob()]);
    render(<WorkPlanPage />);

    expect(await screen.findByRole('button', { name: /^run now$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /standing investigation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
  });

  it('keeps viewer work-plan data visible but removes every mutation control', async () => {
    fetchPermissions.mockImplementation(async (workspaceId) => permissions(workspaceId, false));
    jobs.mockResolvedValue([cloudJob()]);
    render(<WorkPlanPage />);

    expect(await screen.findByText(/cloud watcher/i)).toBeInTheDocument();
    expect(screen.getByText(/work plan is read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^run now$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /standing investigation/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^cadence$/i)).not.toBeInTheDocument();
  });
});
