import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceExportPanel } from './WorkspaceExportPanel';
import { SOURCE_CLI_COMMAND } from '@/lib/cli';
import { fetchPublicReleaseGates } from '@/lib/auth';
import { PostshowFunctionError } from '@/lib/functionClient';
import {
  beginWorkspaceExport,
  cancelWorkspaceExport,
  createWorkspaceExportDownload,
  fetchCurrentWorkspaceExport,
  fetchWorkspaceExportStatus,
  type WorkspaceExportStatus,
} from '@/lib/workspaceExport';

vi.mock('@/lib/workspaceExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaceExport')>();
  return {
    ...actual,
    beginWorkspaceExport: vi.fn(),
    cancelWorkspaceExport: vi.fn(),
    createWorkspaceExportDownload: vi.fn(),
    fetchCurrentWorkspaceExport: vi.fn(),
    fetchWorkspaceExportStatus: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({ fetchPublicReleaseGates: vi.fn() }));

const begin = vi.mocked(beginWorkspaceExport);
const cancel = vi.mocked(cancelWorkspaceExport);
const createDownload = vi.mocked(createWorkspaceExportDownload);
const fetchCurrent = vi.mocked(fetchCurrentWorkspaceExport);
const fetchStatus = vi.mocked(fetchWorkspaceExportStatus);
const fetchGates = vi.mocked(fetchPublicReleaseGates);
const workspaceId = '22222222-2222-4222-8222-222222222222';
const requestId = '11111111-1111-4111-8111-111111111111';
const filename = `postshow-workspace-${workspaceId}-${requestId}.ndjson`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function queuedStatus(): WorkspaceExportStatus {
  return {
    request_id: requestId,
    workspace_id: workspaceId,
    state: 'queued',
    schema_version: 3,
    format: 'postshow-workspace-ndjson',
    snapshot_at: null,
    record_count: 0,
    artifact_bytes: 0,
    content_type: 'application/x-ndjson',
    filename,
    part_count: 0,
    uploaded_parts: 0,
    checksum_algorithm: 'sha256-part-tree-v1',
    artifact_checksum: null,
    integrity_parts: [],
    requested_at: '2026-07-20T10:00:00.000Z',
    ready_at: null,
    expires_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    error_code: null,
  };
}

function readyStatus(): WorkspaceExportStatus {
  const readyAt = Date.now() - 23 * 60 * 60 * 1000;
  return {
    ...queuedStatus(),
    state: 'ready',
    requested_at: new Date(readyAt - 2_000).toISOString(),
    snapshot_at: new Date(readyAt - 1_000).toISOString(),
    record_count: 8,
    artifact_bytes: 256,
    part_count: 1,
    uploaded_parts: 1,
    artifact_checksum: 'b'.repeat(64),
    integrity_parts: [{ part_number: 1, byte_size: 256, sha256: 'a'.repeat(64) }],
    ready_at: new Date(readyAt).toISOString(),
    expires_at: new Date(readyAt + 24 * 60 * 60 * 1000).toISOString(),
  };
}

describe('WorkspaceExportPanel', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    begin.mockReset().mockResolvedValue(queuedStatus());
    cancel.mockReset();
    createDownload.mockReset();
    fetchCurrent.mockReset().mockResolvedValue(null);
    fetchStatus.mockReset().mockResolvedValue(queuedStatus());
    fetchGates.mockReset().mockResolvedValue({
      signup: true,
      checkout: true,
      hosted_runtime: true,
      plan_changes: true,
      workspace_export: true,
      workspace_deletion: true,
    });
  });

  it('persists a replay key before beginning and renders durable progress', async () => {
    let persistedAtInvocation = '';
    begin.mockImplementation(async () => {
      persistedAtInvocation = values.get(`postshow.workspace-export.${workspaceId}`) ?? '';
      return queuedStatus();
    });
    render(<WorkspaceExportPanel workspaceId={workspaceId} />);

    fireEvent.click(await screen.findByRole('button', { name: /prepare export/i }));

    await waitFor(() => expect(begin).toHaveBeenCalledWith(workspaceId, expect.any(String)));
    expect(persistedAtInvocation).toContain('"requestId":null');
    expect(persistedAtInvocation).toContain('"beginKey"');
    expect(await screen.findByText(/queued safely/i)).toBeInTheDocument();
    expect(screen.getByText(requestId)).toBeInTheDocument();
    expect(values.get(`postshow.workspace-export.${workspaceId}`)).toContain(requestId);
    expect(screen.getByRole('status', { name: /workspace export status/i })).toHaveFocus();
  });

  it('recovers the current export when localStorage is missing or blocked', async () => {
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
    fetchCurrent.mockResolvedValue(queuedStatus());

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);

    expect(await screen.findByText(/queued safely/i)).toBeInTheDocument();
    expect(fetchCurrent).toHaveBeenCalledWith(workspaceId);
    expect(begin).not.toHaveBeenCalled();
  });

  it('pauses only new begins while preserving a recovered export when its gate is closed', async () => {
    fetchGates.mockResolvedValue({
      signup: true,
      checkout: true,
      hosted_runtime: true,
      plan_changes: true,
      workspace_export: false,
      workspace_deletion: false,
    });
    const ready = readyStatus();
    fetchCurrent.mockResolvedValue(ready);
    fetchStatus.mockResolvedValue(ready);

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);

    expect(await screen.findByText(/export ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download ndjson/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start removal/i })).toBeEnabled();
    expect(begin).not.toHaveBeenCalled();
  });

  it('fails closed on a new begin while the workspace-export gate is closed', async () => {
    fetchGates.mockResolvedValue({
      signup: true,
      checkout: true,
      hosted_runtime: true,
      plan_changes: true,
      workspace_export: false,
      workspace_deletion: false,
    });

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);

    expect(await screen.findByRole('button', { name: /new exports paused/i })).toBeDisabled();
    expect(screen.getByText(/new export creation is temporarily paused/i)).toBeInTheDocument();
    expect(begin).not.toHaveBeenCalled();
  });

  it('recovers and verifies a saved request after navigation', async () => {
    values.set(
      `postshow.workspace-export.${workspaceId}`,
      JSON.stringify({
        version: 1,
        requestId,
        beginKey: '33333333-3333-4333-8333-333333333333',
        cancelKey: null,
      })
    );
    fetchStatus.mockResolvedValue(readyStatus());

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);

    await waitFor(() => expect(fetchStatus).toHaveBeenCalledWith(requestId));
    expect(await screen.findByText(/export ready/i)).toBeInTheDocument();
    expect(screen.getByText('b'.repeat(64))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download ndjson/i })).toBeEnabled();
  });

  it('streams through a short-lived URL and never creates a blob for the artifact', async () => {
    values.set(
      `postshow.workspace-export.${workspaceId}`,
      JSON.stringify({
        version: 1,
        requestId,
        beginKey: '33333333-3333-4333-8333-333333333333',
        cancelKey: null,
      })
    );
    const ready = readyStatus();
    fetchStatus.mockResolvedValue(ready);
    createDownload.mockResolvedValue({
      url: 'https://project-ref.supabase.co/signed?token=secret',
      expires_at: new Date(Date.now() + 45 * 1000).toISOString(),
      filename,
      content_type: 'application/x-ndjson',
      artifact_bytes: 256,
      checksum_algorithm: 'sha256-part-tree-v1',
      artifact_checksum: 'b'.repeat(64),
      integrity_parts: ready.integrity_parts,
    });
    const clicked: Array<{ href: string; download: string; referrerPolicy: string }> = [];
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: typeof window.HTMLAnchorElement.prototype
    ) {
      clicked.push({
        href: this.href,
        download: this.download,
        referrerPolicy: this.referrerPolicy,
      });
    });
    const createObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);
    fireEvent.click(await screen.findByRole('button', { name: /download ndjson/i }));

    await waitFor(() => expect(createDownload).toHaveBeenCalledWith(ready));
    expect(clicked).toEqual([
      {
        href: 'https://project-ref.supabase.co/signed?token=secret',
        download: filename,
        referrerPolicy: 'no-referrer',
      },
    ]);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(await screen.findByText(/download started/i)).toBeInTheDocument();
  });

  it('downloads a separate verification manifest with no signed bearer', async () => {
    values.set(
      `postshow.workspace-export.${workspaceId}`,
      JSON.stringify({
        version: 1,
        requestId,
        beginKey: '33333333-3333-4333-8333-333333333333',
        cancelKey: null,
      })
    );
    fetchStatus.mockResolvedValue(readyStatus());
    const createObjectURL = vi.fn().mockReturnValue('blob:integrity');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);
    fireEvent.click(await screen.findByRole('button', { name: /download integrity manifest/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const body = await blob.text();
    expect(body).toContain('"manifest_type": "postshow_workspace_export_integrity"');
    expect(body).toContain('"artifact_checksum": "bbbb');
    expect(body).not.toContain('token=');
  });

  it('shows the exact CLI verification syntax and copies a command for the downloaded files', async () => {
    values.set(
      `postshow.workspace-export.${workspaceId}`,
      JSON.stringify({
        version: 1,
        requestId,
        beginKey: '33333333-3333-4333-8333-333333333333',
        cancelKey: null,
      })
    );
    fetchStatus.mockResolvedValue(readyStatus());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const command = `${SOURCE_CLI_COMMAND} export verify ${filename} ${filename}.integrity.json`;

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);

    expect(await screen.findByText(command)).toBeInTheDocument();
    expect(
      screen.getByText(`${SOURCE_CLI_COMMAND} export verify <artifact> <manifest>`)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy verification command/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command));
    expect(await screen.findByText(/verification command copied/i)).toBeInTheDocument();
  });

  it('requires confirmation, persists one cancel key, and clears recovery on removal', async () => {
    cancel.mockResolvedValue({
      ...queuedStatus(),
      state: 'canceled',
      canceled_at: '2026-07-20T10:01:00.000Z',
    });
    render(<WorkspaceExportPanel workspaceId={workspaceId} />);
    fireEvent.click(await screen.findByRole('button', { name: /prepare export/i }));
    await screen.findByText(/queued safely/i);

    fireEvent.click(screen.getByRole('button', { name: /cancel export/i }));
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /confirm remove export/i })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /keep export/i }));
    expect(screen.getByRole('button', { name: /cancel export/i })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /cancel export/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm remove export/i }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith(requestId, expect.any(String)));
    expect(await screen.findByText('Export removed')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /workspace export status/i })).toHaveFocus();
    expect(values.has(`postshow.workspace-export.${workspaceId}`)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /prepare another export/i }));
    expect(await screen.findByRole('button', { name: /prepare export/i })).toHaveFocus();
  });

  it.each([401, 403])(
    'retains its recovery pointer after a transient %s response',
    async (status) => {
      values.set(
        `postshow.workspace-export.${workspaceId}`,
        JSON.stringify({
          version: 1,
          requestId,
          beginKey: '33333333-3333-4333-8333-333333333333',
          cancelKey: null,
        })
      );
      fetchStatus.mockRejectedValue(
        new PostshowFunctionError('Workspace export access must be checked again.', '', status)
      );

      render(<WorkspaceExportPanel workspaceId={workspaceId} />);

      expect(await screen.findByRole('alert')).toHaveTextContent(/checked again/i);
      expect(values.get(`postshow.workspace-export.${workspaceId}`)).toContain(requestId);
    }
  );

  it('keeps polling after a poll timer races a failed cancellation', async () => {
    vi.useFakeTimers();
    try {
      values.set(
        `postshow.workspace-export.${workspaceId}`,
        JSON.stringify({
          version: 1,
          requestId,
          beginKey: '33333333-3333-4333-8333-333333333333',
          cancelKey: null,
        })
      );
      const cancellation = deferred<WorkspaceExportStatus>();
      cancel.mockReturnValue(cancellation.promise);

      render(<WorkspaceExportPanel workspaceId={workspaceId} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(/queued safely/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel export/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm remove export/i }));
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
      });

      await act(async () => {
        cancellation.reject(new Error('temporary cancellation transport failure'));
        await Promise.resolve();
      });
      const callsBeforeRetry = fetchStatus.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(15_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(fetchStatus.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when a recovered request belongs to another workspace', async () => {
    values.set(
      `postshow.workspace-export.${workspaceId}`,
      JSON.stringify({
        version: 1,
        requestId,
        beginKey: '33333333-3333-4333-8333-333333333333',
        cancelKey: null,
      })
    );
    fetchStatus.mockResolvedValue({
      ...queuedStatus(),
      workspace_id: '44444444-4444-4444-8444-444444444444',
    });

    render(<WorkspaceExportPanel workspaceId={workspaceId} />);

    expect(await screen.findByText(/different workspace/i)).toBeInTheDocument();
    expect(screen.queryByText(/queued safely/i)).not.toBeInTheDocument();
  });
});
