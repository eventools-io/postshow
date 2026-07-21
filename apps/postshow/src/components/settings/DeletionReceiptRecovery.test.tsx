import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PostshowFunctionError } from '@/lib/functionClient';
import {
  cancelWorkspaceDeletion,
  fetchRequesterWorkspaceDeletions,
  fetchWorkspaceDeletionStatus,
  type RequesterWorkspaceDeletions,
  type WorkspaceDeletionStatus,
} from '@/lib/workspaceLifecycle';
import { DeletionReceiptRecovery } from './WorkspaceLifecycleSection';

const { mockUseWorkspace } = vi.hoisted(() => ({ mockUseWorkspace: vi.fn() }));

vi.mock('@/state/WorkspaceContext', () => ({ useWorkspace: mockUseWorkspace }));
vi.mock('@/lib/workspaceLifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaceLifecycle')>();
  return {
    ...actual,
    cancelWorkspaceDeletion: vi.fn(),
    fetchRequesterWorkspaceDeletions: vi.fn(),
    fetchWorkspaceDeletionStatus: vi.fn(),
  };
});

const userA = 'user-a';
const userB = 'user-b';
const workspaceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestA = '11111111-1111-4111-8111-111111111111';
const requestB = '22222222-2222-4222-8222-222222222222';
const beginKey = '33333333-3333-4333-8333-333333333333';

const completedRequest: WorkspaceDeletionStatus = {
  request_id: requestA,
  state: 'completed',
  progress: 'completed',
  requested_at: '2026-07-21T10:00:00.000Z',
  completed_at: '2026-07-21T10:05:00.000Z',
  canceled_at: null,
  receipt_available_until: '2099-08-20T10:05:00.000Z',
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
  error_code: null,
  can_cancel: false,
};

const activeRequest: WorkspaceDeletionStatus = {
  ...completedRequest,
  request_id: requestB,
  state: 'pending',
  progress: 'provider_cleanup',
  requested_at: '2026-07-21T11:00:00.000Z',
  completed_at: null,
  receipt_available_until: null,
  completion_receipt: null,
  retry_at: '2099-08-20T10:06:00.000Z',
  can_cancel: true,
};

function recoveryIndexKey(userId: string) {
  return `postshow.workspace-deletion-recovery.v1.${userId}`;
}

function scopedKey(userId: string, workspaceId = workspaceA) {
  return `postshow.workspace-deletion.${userId}.${workspaceId}`;
}

function authenticatedWorkspace(userId: string) {
  return {
    session: { user: { id: userId } },
    workspace: null,
    workspaceLoading: false,
  };
}

function list(
  entries: Array<{ workspaceId: string; label: string; request: WorkspaceDeletionStatus }>,
  truncated = false
): RequesterWorkspaceDeletions {
  return {
    requests: entries.map((entry) => ({
      workspace_id: entry.workspaceId,
      workspace_label: entry.label,
      request: entry.request,
    })),
    truncated,
  };
}

function installStorage(
  userId = userA,
  workspaceId = workspaceA,
  requestId = requestA
): Map<string, string> {
  const values = new Map<string, string>([
    [recoveryIndexKey(userId), JSON.stringify([{ workspaceId, requestId }])],
    [scopedKey(userId, workspaceId), JSON.stringify({ requestId, beginKey })],
  ]);
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

describe('DeletionReceiptRecovery', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockUseWorkspace.mockReset().mockReturnValue(authenticatedWorkspace(userA));
    vi.mocked(fetchRequesterWorkspaceDeletions).mockReset().mockResolvedValue(list([]));
    vi.mocked(fetchWorkspaceDeletionStatus).mockReset();
    vi.mocked(cancelWorkspaceDeletion)
      .mockReset()
      .mockResolvedValue({
        ...activeRequest,
        state: 'canceled',
        canceled_at: '2026-07-21T11:01:00.000Z',
        retry_at: null,
        can_cancel: false,
      });
    installStorage();
  });

  it('recovers a server-discovered completed receipt without trusting browser state', async () => {
    const values = installStorage();
    vi.mocked(fetchRequesterWorkspaceDeletions).mockResolvedValue(
      list([{ workspaceId: workspaceA, label: 'Deleted workspace', request: completedRequest }])
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const createObjectURL = vi.fn().mockReturnValue('blob:deletion-receipt');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<DeletionReceiptRecovery />);

    expect(await screen.findByText('Deleted workspace')).toBeInTheDocument();
    expect(screen.getByText(requestA)).toBeInTheDocument();
    expect(fetchWorkspaceDeletionStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /copy receipt/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"receipt_type"'))
    );
    fireEvent.click(screen.getByRole('button', { name: /download receipt/i }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));

    fireEvent.click(screen.getByRole('button', { name: /hide saved receipt/i }));
    expect(values.has(scopedKey(userA))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /confirm hide/i }));
    await waitFor(() => expect(screen.queryByText(requestA)).not.toBeInTheDocument());
    expect(values.has(scopedKey(userA))).toBe(false);
    expect(values.has(recoveryIndexKey(userA))).toBe(false);
  });

  it('renders multiple server-bound workspaces and cancels an active deletion globally', async () => {
    installStorage(userA, workspaceB, requestB);
    vi.mocked(fetchRequesterWorkspaceDeletions)
      .mockResolvedValueOnce(
        list([
          { workspaceId: workspaceB, label: 'Northwind launch', request: activeRequest },
          { workspaceId: workspaceA, label: 'Deleted workspace', request: completedRequest },
        ])
      )
      .mockResolvedValueOnce(
        list([{ workspaceId: workspaceA, label: 'Deleted workspace', request: completedRequest }])
      );

    render(<DeletionReceiptRecovery />);

    expect(await screen.findByText('Northwind launch')).toBeInTheDocument();
    expect(screen.getByText('Deleted workspace')).toBeInTheDocument();
    expect(screen.getByText(/closing billing-provider resources/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel deletion/i }));
    await waitFor(() =>
      expect(cancelWorkspaceDeletion).toHaveBeenCalledWith(requestB, expect.any(String))
    );
    expect(await screen.findByText(/workspace deletion canceled/i)).toBeInTheDocument();
  });

  it('recovers active deletion after blocked-storage lost-response reload using only server state', async () => {
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
    vi.mocked(fetchRequesterWorkspaceDeletions).mockResolvedValue(
      list([{ workspaceId: workspaceB, label: 'Recovered workspace', request: activeRequest }])
    );

    render(<DeletionReceiptRecovery />);

    expect(await screen.findByText('Recovered workspace')).toBeInTheDocument();
    expect(screen.getByText(requestB)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel deletion/i })).toBeEnabled();
    expect(fetchWorkspaceDeletionStatus).not.toHaveBeenCalled();
  });

  it('isolates requester discovery across an A to B to A actor switch', async () => {
    const values = installStorage();
    vi.mocked(fetchRequesterWorkspaceDeletions)
      .mockResolvedValueOnce(
        list([{ workspaceId: workspaceA, label: 'A receipt', request: completedRequest }])
      )
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(
        list([{ workspaceId: workspaceA, label: 'A receipt', request: completedRequest }])
      );
    const { rerender } = render(<DeletionReceiptRecovery />);
    expect(await screen.findByText('A receipt')).toBeInTheDocument();

    mockUseWorkspace.mockReturnValue(authenticatedWorkspace(userB));
    rerender(<DeletionReceiptRecovery />);
    await waitFor(() => expect(screen.queryByText('A receipt')).not.toBeInTheDocument());
    expect(values.has(scopedKey(userA))).toBe(true);
    expect(values.has(recoveryIndexKey(userA))).toBe(true);

    mockUseWorkspace.mockReturnValue(authenticatedWorkspace(userA));
    rerender(<DeletionReceiptRecovery />);
    expect(await screen.findByText('A receipt')).toBeInTheDocument();
    expect(fetchRequesterWorkspaceDeletions).toHaveBeenCalledTimes(3);
  });

  it('fences a delayed A requester response after switching to B', async () => {
    const values = installStorage();
    let resolveA: (value: RequesterWorkspaceDeletions) => void = () => undefined;
    vi.mocked(fetchRequesterWorkspaceDeletions)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveA = resolve;
        })
      )
      .mockResolvedValueOnce(list([]));
    const { rerender } = render(<DeletionReceiptRecovery />);
    await waitFor(() => expect(fetchRequesterWorkspaceDeletions).toHaveBeenCalledTimes(1));

    mockUseWorkspace.mockReturnValue(authenticatedWorkspace(userB));
    rerender(<DeletionReceiptRecovery />);
    resolveA(list([{ workspaceId: workspaceA, label: 'A receipt', request: completedRequest }]));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('A receipt')).not.toBeInTheDocument();
    expect(values.has(scopedKey(userA))).toBe(true);
    expect(values.has(recoveryIndexKey(userA))).toBe(true);
  });

  it.each([401, 403])(
    'retains supplemental recovery pointers after a %s response',
    async (status) => {
      const values = installStorage();
      vi.mocked(fetchRequesterWorkspaceDeletions).mockRejectedValue(
        new PostshowFunctionError('Unavailable', 'auth_unavailable', status)
      );
      vi.mocked(fetchWorkspaceDeletionStatus).mockRejectedValue(
        new PostshowFunctionError('Unavailable', 'auth_unavailable', status)
      );

      render(<DeletionReceiptRecovery />);

      expect(await screen.findByRole('alert')).toHaveTextContent(/pointers were retained/i);
      expect(values.has(scopedKey(userA))).toBe(true);
      expect(values.has(recoveryIndexKey(userA))).toBe(true);
      expect(screen.queryByText(requestA)).not.toBeInTheDocument();
    }
  );

  it('clears a supplemental pointer only after authoritative not-found', async () => {
    const values = installStorage();
    vi.mocked(fetchRequesterWorkspaceDeletions).mockResolvedValue(list([]));
    vi.mocked(fetchWorkspaceDeletionStatus).mockRejectedValue(
      new PostshowFunctionError('Not found', 'not_found', 404)
    );

    render(<DeletionReceiptRecovery />);

    await waitFor(() => expect(values.has(scopedKey(userA))).toBe(false));
    expect(values.has(recoveryIndexKey(userA))).toBe(false);
  });
});
