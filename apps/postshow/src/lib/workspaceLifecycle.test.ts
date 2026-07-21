import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginWorkspaceDeletion,
  cancelWorkspaceDeletion,
  fetchCurrentWorkspaceDeletion,
  fetchRequesterWorkspaceDeletions,
  fetchWorkspaceDeletionStatus,
} from './workspaceLifecycle';
import { invokePostshowFunction } from './functionClient';

vi.mock('./functionClient', () => ({ invokePostshowFunction: vi.fn() }));

const invoke = vi.mocked(invokePostshowFunction);
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = {
  request_id: '11111111-1111-4111-8111-111111111111',
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

describe('workspace lifecycle client', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('starts deletion through the service endpoint without direct table access', async () => {
    invoke.mockResolvedValue({ ok: true, request });

    await expect(
      beginWorkspaceDeletion(workspaceId, 'Acme Cloud', 'request-key', 'fresh-jwt')
    ).resolves.toEqual(request);
    expect(invoke).toHaveBeenCalledWith(
      'postshow-workspace-deletion',
      {
        op: 'begin',
        workspace_id: workspaceId,
        expected_name: 'Acme Cloud',
        idempotency_key: 'request-key',
      },
      { accessToken: 'fresh-jwt' }
    );
  });

  it('fails closed on an unknown worker state', async () => {
    invoke.mockResolvedValue({ ok: true, request: { ...request, state: 'mystery' } });
    await expect(fetchWorkspaceDeletionStatus(request.request_id)).rejects.toThrow(
      /deletion state/i
    );
  });

  it('discovers the authenticated actor current deletion without browser state', async () => {
    invoke.mockResolvedValue({
      ok: true,
      requests: [{ workspace_id: workspaceId, workspace_label: 'Acme Cloud', request }],
      truncated: false,
    });

    await expect(fetchCurrentWorkspaceDeletion(workspaceId)).resolves.toEqual(request);
    expect(invoke).toHaveBeenCalledWith('postshow-workspace-deletion', {
      op: 'current',
    });

    invoke.mockResolvedValue({ ok: true, requests: [], truncated: false });
    await expect(fetchCurrentWorkspaceDeletion(workspaceId)).resolves.toBeNull();
  });

  it('returns the bounded requester-scoped deletion list for global recovery', async () => {
    const older = {
      ...request,
      request_id: '22222222-2222-4222-8222-222222222222',
      requested_at: '2026-07-20T10:00:00.000Z',
    };
    invoke.mockResolvedValue({
      ok: true,
      requests: [
        { workspace_id: workspaceId, workspace_label: 'Acme Cloud', request },
        {
          workspace_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          workspace_label: 'Deleted workspace',
          request: older,
        },
      ],
      truncated: true,
    });

    await expect(fetchRequesterWorkspaceDeletions()).resolves.toEqual({
      requests: [
        { workspace_id: workspaceId, workspace_label: 'Acme Cloud', request },
        {
          workspace_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          workspace_label: 'Deleted workspace',
          request: older,
        },
      ],
      truncated: true,
    });
  });

  it('strictly validates the current-deletion response envelope', async () => {
    invoke.mockResolvedValue({ ok: true, request });
    await expect(fetchCurrentWorkspaceDeletion(workspaceId)).rejects.toThrow(
      /invalid deletion response/i
    );

    invoke.mockResolvedValue({ ok: true, requests: [], truncated: false, extra: true });
    await expect(fetchCurrentWorkspaceDeletion(workspaceId)).rejects.toThrow(
      /invalid deletion response/i
    );
  });

  it('rejects status for a different deletion request', async () => {
    invoke.mockResolvedValue({
      ok: true,
      request: { ...request, request_id: '22222222-2222-4222-8222-222222222222' },
    });

    await expect(fetchWorkspaceDeletionStatus(request.request_id)).rejects.toThrow(
      /different deletion request/i
    );
  });

  it('strictly validates a completed deletion receipt', async () => {
    const hash = 'a'.repeat(64);
    const completed = {
      ...request,
      state: 'completed',
      progress: 'completed',
      completed_at: '2026-07-21T10:05:00.000Z',
      receipt_available_until: '2026-08-20T10:05:00.000Z',
      completion_receipt: {
        version: 1,
        completed_generation: 2,
        target_count: 4,
        provider_target_hash: hash,
        target_manifest_hash: 'b'.repeat(64),
        usage_ledger_hash: 'c'.repeat(64),
        outcome_hash: 'd'.repeat(64),
      },
      retry_at: null,
      can_cancel: false,
    };
    invoke.mockResolvedValue({ ok: true, request: completed });

    await expect(fetchWorkspaceDeletionStatus(request.request_id)).resolves.toEqual(completed);
  });

  it('rejects missing, premature, or malformed completion receipts', async () => {
    invoke.mockResolvedValue({
      ok: true,
      request: { ...request, completion_receipt: undefined },
    });
    await expect(fetchWorkspaceDeletionStatus(request.request_id)).rejects.toThrow(
      /deletion receipt/i
    );

    invoke.mockResolvedValue({
      ok: true,
      request: {
        ...request,
        completion_receipt: {
          version: 1,
          completed_generation: 1,
          target_count: 0,
          provider_target_hash: 'a'.repeat(64),
          target_manifest_hash: 'b'.repeat(64),
          usage_ledger_hash: 'c'.repeat(64),
          outcome_hash: 'd'.repeat(64),
        },
      },
    });
    await expect(fetchWorkspaceDeletionStatus(request.request_id)).rejects.toThrow(/inconsistent/i);

    invoke.mockResolvedValue({
      ok: true,
      request: {
        ...request,
        state: 'completed',
        progress: 'completed',
        completed_at: '2026-07-21T10:05:00.000Z',
        receipt_available_until: '2026-08-20T10:05:00.000Z',
        completion_receipt: {
          version: 1,
          completed_generation: 1,
          target_count: 0,
          provider_target_hash: 'not-a-hash',
          target_manifest_hash: 'b'.repeat(64),
          usage_ledger_hash: 'c'.repeat(64),
          outcome_hash: 'd'.repeat(64),
        },
        retry_at: null,
        can_cancel: false,
      },
    });
    await expect(fetchWorkspaceDeletionStatus(request.request_id)).rejects.toThrow(
      /provider target hash/i
    );
  });

  it.each([
    ['begin', () => beginWorkspaceDeletion(workspaceId, 'Acme Cloud', 'request-key', 'fresh-jwt')],
    ['status', () => fetchWorkspaceDeletionStatus(request.request_id)],
    ['cancel', () => cancelWorkspaceDeletion(request.request_id, 'cancel-key')],
  ])('rejects extra fields in the %s response envelope', async (_operation, invokeClient) => {
    invoke.mockResolvedValue({ ok: true, request, extra: true });
    await expect(invokeClient()).rejects.toThrow(/invalid deletion response/i);
  });
});
