import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { fetchPublicReleaseGates } from '@/lib/auth';
import { PostshowFunctionError } from '@/lib/functionClient';
import {
  beginWorkspaceDeletion,
  cancelWorkspaceDeletion,
  fetchCurrentWorkspaceDeletion,
  fetchWorkspaceDeletionStatus,
  type WorkspaceDeletionState,
  type WorkspaceDeletionStatus,
} from '@/lib/workspaceLifecycle';
import { WorkspaceLifecycleSection } from './WorkspaceLifecycleSection';

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));

vi.mock('@/components/settings/WorkspaceExportPanel', () => ({
  WorkspaceExportPanel: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="workspace-export-panel" data-disabled={String(Boolean(disabled))}>
      Workspace export panel
    </div>
  ),
}));

vi.mock('@/lib/auth', () => ({ fetchPublicReleaseGates: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('@/lib/workspaceLifecycle', () => ({
  beginWorkspaceDeletion: vi.fn(),
  cancelWorkspaceDeletion: vi.fn(),
  fetchCurrentWorkspaceDeletion: vi.fn(),
  fetchWorkspaceDeletionStatus: vi.fn(),
}));

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = '11111111-1111-4111-8111-111111111111';
const beginKey = '22222222-2222-4222-8222-222222222222';
const persistenceKey = `postshow.workspace-deletion.${actorId}.${workspaceId}`;
const recoveryIndexKey = `postshow.workspace-deletion-recovery.v1.${actorId}`;
const session = {
  access_token: 'current-jwt',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: actorId, email: 'owner@example.com' },
} as Session;

const request: WorkspaceDeletionStatus = {
  request_id: requestId,
  state: 'pending',
  progress: 'queued',
  requested_at: '2026-07-21T10:00:00.000Z',
  completed_at: null,
  canceled_at: null,
  receipt_available_until: null,
  completion_receipt: null,
  retry_at: '2026-07-21T10:01:00.000Z',
  error_code: null,
  can_cancel: true,
};

const releaseGates = {
  signup: true,
  checkout: true,
  hosted_runtime: true,
  plan_changes: true,
  workspace_export: true,
  workspace_deletion: true,
};

function installStorage(initial: [string, string][] = []): Map<string, string> {
  const values = new Map(initial);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  return values;
}

function persistDeletion(statusRequestId: string | null = requestId) {
  const initial: [string, string][] = [
    [persistenceKey, JSON.stringify({ requestId: statusRequestId, beginKey })],
  ];
  if (statusRequestId) {
    initial.push([recoveryIndexKey, JSON.stringify([{ workspaceId, requestId: statusRequestId }])]);
  }
  return installStorage(initial);
}

function renderLifecycle(onDeleted = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <WorkspaceLifecycleSection
      session={session}
      workspaceId={workspaceId}
      workspaceName="Acme Cloud"
      onDeleted={onDeleted}
    />
  );
}

async function openReview() {
  const review = await screen.findByRole('button', { name: /review workspace deletion/i });
  await waitFor(() => expect(review).toBeEnabled());
  fireEvent.click(review);
}

async function fillDeletionProof() {
  await openReview();
  fireEvent.change(screen.getByLabelText(/type the workspace name exactly/i), {
    target: { value: 'Acme Cloud' },
  });
  fireEvent.change(screen.getByLabelText(/type delete acme cloud/i), {
    target: { value: 'DELETE Acme Cloud' },
  });
}

describe('WorkspaceLifecycleSection', () => {
  beforeEach(() => {
    installStorage();
    vi.mocked(fetchPublicReleaseGates).mockReset().mockResolvedValue(releaseGates);
    auth.signInWithPassword.mockReset().mockResolvedValue({
      data: { session: { ...session, access_token: 'fresh-jwt' } },
      error: null,
    });
    vi.mocked(fetchCurrentWorkspaceDeletion).mockReset().mockResolvedValue(null);
    vi.mocked(beginWorkspaceDeletion).mockReset().mockResolvedValue(request);
    vi.mocked(cancelWorkspaceDeletion)
      .mockReset()
      .mockResolvedValue({
        ...request,
        state: 'canceled',
        canceled_at: '2026-07-21T10:00:05.000Z',
        can_cancel: false,
      });
    vi.mocked(fetchWorkspaceDeletionStatus).mockReset().mockResolvedValue(request);
  });

  it('requires both exact-name and typed destructive confirmation', async () => {
    renderLifecycle();
    await openReview();
    const submit = screen.getByRole('button', { name: /permanently delete workspace/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type the workspace name exactly/i), {
      target: { value: 'Acme Cloud' },
    });
    fireEvent.change(screen.getByLabelText(/type delete acme cloud/i), {
      target: { value: 'DELETE Acme Cloud' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(beginWorkspaceDeletion).toHaveBeenCalledWith(
        workspaceId,
        'Acme Cloud',
        expect.any(String),
        'current-jwt'
      )
    );
    expect(await screen.findByText(/queued safely/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel deletion/i })).toBeInTheDocument();
  });

  it('uses password reauthentication when supplied before a new deletion', async () => {
    renderLifecycle();
    await fillDeletionProof();
    fireEvent.change(screen.getByLabelText(/password.*optional/i), {
      target: { value: 'fresh-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /permanently delete workspace/i }));

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'owner@example.com',
        password: 'fresh-password',
      })
    );
    expect(beginWorkspaceDeletion).toHaveBeenCalledWith(
      workspaceId,
      'Acme Cloud',
      expect.any(String),
      'fresh-jwt'
    );
  });

  it('guides a stale passwordless session through its normal sign-in method', async () => {
    vi.mocked(beginWorkspaceDeletion).mockRejectedValue(
      new PostshowFunctionError('provider detail', 'reauthentication_required', 401)
    );
    renderLifecycle();
    await fillDeletionProof();
    fireEvent.click(screen.getByRole('button', { name: /permanently delete workspace/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign out and sign in again/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/OAuth.*magic link.*SSO.*MFA/i);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('disables export immediately while an unresolved deletion begin is in flight', async () => {
    let resolveBegin: (value: WorkspaceDeletionStatus) => void = () => undefined;
    vi.mocked(beginWorkspaceDeletion).mockReturnValue(
      new Promise((resolve) => {
        resolveBegin = resolve;
      })
    );
    renderLifecycle();
    expect(screen.getByTestId('workspace-export-panel')).toHaveAttribute('data-disabled', 'false');

    await fillDeletionProof();
    fireEvent.click(screen.getByRole('button', { name: /permanently delete workspace/i }));

    await waitFor(() => expect(beginWorkspaceDeletion).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('workspace-export-panel')).toHaveAttribute('data-disabled', 'true');
    resolveBegin(request);
    expect(await screen.findByText(/queued safely/i)).toBeInTheDocument();
  });

  it.each<WorkspaceDeletionState>([
    'pending',
    'claimed',
    'failed',
    'uncertain',
    'dead_letter',
    'completed',
  ])('keeps export disabled for the %s deletion lifecycle state', async (state) => {
    persistDeletion();
    vi.mocked(fetchWorkspaceDeletionStatus).mockResolvedValue({
      ...request,
      state,
      progress: state === 'completed' ? 'completed' : request.progress,
      can_cancel: state === 'pending',
    });
    renderLifecycle();

    await waitFor(() =>
      expect(screen.getByTestId('workspace-export-panel')).toHaveAttribute('data-disabled', 'true')
    );
  });

  it('returns to a safe active state after confirmed cancellation', async () => {
    renderLifecycle();
    await fillDeletionProof();
    fireEvent.click(screen.getByRole('button', { name: /permanently delete workspace/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel deletion/i }));

    await waitFor(() => expect(cancelWorkspaceDeletion).toHaveBeenCalled());
    expect(await screen.findByText(/workspace deletion canceled/i)).toBeInTheDocument();
    expect(screen.getByTestId('workspace-export-panel')).toHaveAttribute('data-disabled', 'false');
  });

  it('hydrates an existing server deletion when localStorage is blocked', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    vi.mocked(fetchCurrentWorkspaceDeletion).mockResolvedValue(request);

    renderLifecycle();

    expect(await screen.findByText(/queued safely/i)).toBeInTheDocument();
    expect(fetchCurrentWorkspaceDeletion).toHaveBeenCalledWith(workspaceId);
    expect(screen.getByRole('button', { name: /cancel deletion/i })).toBeInTheDocument();
    expect(screen.getByTestId('workspace-export-panel')).toHaveAttribute('data-disabled', 'true');
  });

  it('preserves the original begin key when current discovery recovers a lost response', async () => {
    const values = persistDeletion(null);
    vi.mocked(fetchCurrentWorkspaceDeletion).mockResolvedValue(request);

    renderLifecycle();

    expect(await screen.findByText(/queued safely/i)).toBeInTheDocument();
    expect(JSON.parse(values.get(persistenceKey) ?? '{}')).toEqual({
      requestId,
      beginKey,
    });
    expect(JSON.parse(values.get(recoveryIndexKey) ?? '[]')).toEqual([{ workspaceId, requestId }]);
  });

  it('recovers an accepted begin after a lost response even when localStorage is blocked', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    vi.mocked(fetchCurrentWorkspaceDeletion)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(request);
    vi.mocked(beginWorkspaceDeletion).mockRejectedValue(new Error('Network request failed'));
    renderLifecycle();

    await fillDeletionProof();
    fireEvent.click(screen.getByRole('button', { name: /permanently delete workspace/i }));

    expect(await screen.findByText(/original response was lost/i)).toBeInTheDocument();
    expect(screen.getByText(/queued safely/i)).toBeInTheDocument();
    expect(fetchCurrentWorkspaceDeletion).toHaveBeenCalledTimes(2);
  });

  it('fails closed when current-deletion discovery fails and can retry recovery', async () => {
    vi.mocked(fetchCurrentWorkspaceDeletion).mockRejectedValueOnce(
      new Error('network unavailable')
    );
    renderLifecycle();

    expect(await screen.findByText(/network unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deletion recovery unavailable/i })).toBeDisabled();
    expect(beginWorkspaceDeletion).not.toHaveBeenCalled();

    vi.mocked(fetchCurrentWorkspaceDeletion).mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: /retry deletion recovery/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /review workspace deletion/i })).toBeEnabled()
    );
  });

  it('blocks only a new deletion when the release gate is closed', async () => {
    vi.mocked(fetchPublicReleaseGates).mockResolvedValue({
      ...releaseGates,
      workspace_deletion: false,
    });
    renderLifecycle();

    expect(await screen.findByRole('button', { name: /new deletions paused/i })).toBeDisabled();
    expect(
      screen.getByText(/status, cancellation, automatic recovery, and receipt access/i)
    ).toBeInTheDocument();
    expect(beginWorkspaceDeletion).not.toHaveBeenCalled();
  });

  it('keeps an existing deletion visible and cancellable while the release gate is closed', async () => {
    persistDeletion();
    vi.mocked(fetchPublicReleaseGates).mockResolvedValue({
      ...releaseGates,
      workspace_deletion: false,
    });
    renderLifecycle();

    expect(await screen.findByText(/queued safely/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel deletion/i })).toBeEnabled();
    expect(fetchCurrentWorkspaceDeletion).not.toHaveBeenCalled();
  });

  it('fails closed when release-gate verification is unavailable', async () => {
    vi.mocked(fetchPublicReleaseGates).mockRejectedValue(new Error('gate offline'));
    renderLifecycle();

    expect(
      await screen.findByRole('button', { name: /deletion availability unavailable/i })
    ).toBeDisabled();
    expect(screen.getByText(/existing deletion recovery remains available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry availability check/i })).toBeInTheDocument();
  });

  it('makes dead-letter recovery an explicit audited operator action', async () => {
    const failed: WorkspaceDeletionStatus = {
      ...request,
      state: 'dead_letter',
      can_cancel: false,
      retry_at: null,
      error_code: 'provider_unavailable',
    };
    vi.mocked(fetchCurrentWorkspaceDeletion).mockResolvedValue(failed);
    vi.mocked(fetchWorkspaceDeletionStatus).mockResolvedValue(failed);
    renderLifecycle();

    expect(await screen.findByText(/operator must verify the root cause/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry safely/i })).not.toBeInTheDocument();
    expect(beginWorkspaceDeletion).not.toHaveBeenCalled();
  });

  it('shows receipt actions and hashes only after verified completion', async () => {
    persistDeletion();
    const completed: WorkspaceDeletionStatus = {
      ...request,
      state: 'completed',
      progress: 'completed',
      completed_at: '2026-07-21T10:05:00.000Z',
      receipt_available_until: '2026-08-20T10:05:00.000Z',
      completion_receipt: {
        version: 1,
        completed_generation: 2,
        target_count: 4,
        provider_target_hash: 'a'.repeat(64),
        target_manifest_hash: 'b'.repeat(64),
        usage_ledger_hash: 'c'.repeat(64),
        outcome_hash: 'd'.repeat(64),
      },
      retry_at: null,
      can_cancel: false,
    };
    vi.mocked(fetchWorkspaceDeletionStatus).mockResolvedValue(completed);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onDeleted = vi.fn().mockResolvedValue(undefined);
    renderLifecycle(onDeleted);

    expect(await screen.findByText(/verified deletion receipt/i)).toBeInTheDocument();
    expect(screen.getByText('a'.repeat(64))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy receipt/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"version": 1'))
    );
    fireEvent.click(screen.getByRole('button', { name: /leave deleted workspace/i }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('never exposes receipt controls before completion', async () => {
    renderLifecycle();
    await waitFor(() => expect(fetchCurrentWorkspaceDeletion).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /copy receipt/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/verified deletion receipt/i)).not.toBeInTheDocument();
  });
});
