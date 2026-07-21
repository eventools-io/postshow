import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokePostshowFunction } from './functionClient';
import {
  beginWorkspaceExport,
  createWorkspaceExportDownload,
  fetchCurrentWorkspaceExport,
  fetchWorkspaceExportStatus,
  workspaceExportAccessDeadline,
  workspaceExportIntegrityManifest,
  type WorkspaceExportStatus,
} from './workspaceExport';

vi.mock('./functionClient', () => ({ invokePostshowFunction: vi.fn() }));

const invoke = vi.mocked(invokePostshowFunction);
const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const partHash = 'a'.repeat(64);
const artifactHash = 'b'.repeat(64);

function readyStatus(): WorkspaceExportStatus {
  return {
    request_id: requestId,
    workspace_id: workspaceId,
    state: 'ready',
    schema_version: 3,
    format: 'postshow-workspace-ndjson',
    snapshot_at: '2026-07-20T10:00:01.000Z',
    record_count: 4,
    artifact_bytes: 128,
    content_type: 'application/x-ndjson',
    filename: `postshow-workspace-${workspaceId}-${requestId}.ndjson`,
    part_count: 1,
    uploaded_parts: 1,
    checksum_algorithm: 'sha256-part-tree-v1',
    artifact_checksum: artifactHash,
    integrity_parts: [{ part_number: 1, byte_size: 128, sha256: partHash }],
    requested_at: '2026-07-20T10:00:00.000Z',
    ready_at: '2026-07-20T10:00:02.000Z',
    expires_at: '2026-07-21T10:00:02.000Z',
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    error_code: null,
  };
}

describe('workspace export client', () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project-ref.supabase.co');
  });

  it('begins an asynchronous export with an explicit replay key', async () => {
    const status = {
      ...readyStatus(),
      state: 'queued',
      snapshot_at: null,
      ready_at: null,
      expires_at: null,
      artifact_bytes: 0,
      record_count: 0,
      part_count: 0,
      uploaded_parts: 0,
      artifact_checksum: null,
      integrity_parts: [],
    } as WorkspaceExportStatus;
    invoke.mockResolvedValue({ ok: true, request: status });

    await expect(
      beginWorkspaceExport(workspaceId, '33333333-3333-4333-8333-333333333333')
    ).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith('postshow-workspace-export', {
      op: 'begin',
      workspace_id: workspaceId,
      idempotency_key: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('discovers the current server-side export without relying on browser storage', async () => {
    const status = readyStatus();
    invoke.mockResolvedValueOnce({ ok: true, request: status }).mockResolvedValueOnce({
      ok: true,
      request: null,
    });

    await expect(fetchCurrentWorkspaceExport(workspaceId)).resolves.toEqual(status);
    await expect(fetchCurrentWorkspaceExport(workspaceId)).resolves.toBeNull();
    expect(invoke).toHaveBeenNthCalledWith(1, 'postshow-workspace-export', {
      op: 'current',
      workspace_id: workspaceId,
    });
  });

  it('fails closed when current export discovery crosses workspace boundaries', async () => {
    invoke.mockResolvedValue({
      ok: true,
      request: {
        ...readyStatus(),
        workspace_id: '44444444-4444-4444-8444-444444444444',
      },
    });

    await expect(fetchCurrentWorkspaceExport(workspaceId)).rejects.toThrow(/filename|workspace/i);
  });

  it('strictly rejects response drift and inconsistent integrity metadata', async () => {
    invoke.mockResolvedValue({ ok: true, request: { ...readyStatus(), unexpected: true } });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/unexpected status shape/i);

    invoke.mockResolvedValue({
      ok: true,
      request: {
        ...readyStatus(),
        integrity_parts: [{ part_number: 1, byte_size: 127, sha256: partHash }],
      },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/inconsistent ready/i);

    invoke.mockResolvedValue({
      ok: true,
      request: { ...readyStatus(), request_id: '33333333-3333-4333-8333-333333333333' },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/filename/i);

    invoke.mockResolvedValue({
      ok: true,
      request: { ...readyStatus(), expires_at: '2027-07-21T10:00:02.000Z' },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/inconsistent ready/i);

    invoke.mockResolvedValue({
      ok: true,
      request: { ...readyStatus(), expires_at: '2026-07-20T11:00:02.000Z' },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/inconsistent ready/i);

    invoke.mockResolvedValue({
      ok: true,
      request: { ...readyStatus(), record_count: 0 },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/inconsistent ready/i);

    invoke.mockResolvedValue({
      ok: true,
      request: { ...readyStatus(), snapshot_at: '2026-07-20T10:00:03.000Z' },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/inconsistent ready/i);
  });

  it('fails closed on premature integrity disclosure and terminal-state drift', async () => {
    invoke.mockResolvedValue({
      ok: true,
      request: { ...readyStatus(), state: 'uploading', ready_at: null, expires_at: null },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/before.*ready/i);

    invoke.mockResolvedValue({
      ok: true,
      request: {
        ...readyStatus(),
        state: 'failed',
        ready_at: null,
        expires_at: null,
        integrity_parts: [],
        failed_at: null,
      },
    });
    await expect(fetchWorkspaceExportStatus(requestId)).rejects.toThrow(/terminal state/i);
  });

  it('accepts only a short-lived exact-project signed object URL and matching metadata', async () => {
    const status = readyStatus();
    status.ready_at = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    status.expires_at = new Date(Date.parse(status.ready_at) + 24 * 60 * 60 * 1000).toISOString();
    const signedExpiry = new Date(Date.now() + 45 * 1000).toISOString();
    invoke.mockResolvedValue({
      ok: true,
      download: {
        url:
          `https://project-ref.supabase.co/storage/v1/object/sign/` +
          `postshow-workspace-exports/${workspaceId}/${requestId}/workspace.ndjson?` +
          `token=signed&download=${encodeURIComponent(status.filename)}`,
        expires_at: signedExpiry,
        filename: status.filename,
        content_type: status.content_type,
        artifact_bytes: status.artifact_bytes,
        checksum_algorithm: status.checksum_algorithm,
        artifact_checksum: status.artifact_checksum,
        integrity_parts: status.integrity_parts,
      },
    });

    await expect(createWorkspaceExportDownload(status)).resolves.toMatchObject({
      filename: status.filename,
      artifact_checksum: artifactHash,
      expires_at: signedExpiry,
    });
  });

  it('rejects foreign download origins, missing signatures, and metadata substitution', async () => {
    const status = readyStatus();
    status.ready_at = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    status.expires_at = new Date(Date.parse(status.ready_at) + 24 * 60 * 60 * 1000).toISOString();
    const base = {
      expires_at: new Date(Date.now() + 45 * 1000).toISOString(),
      filename: status.filename,
      content_type: status.content_type,
      artifact_bytes: status.artifact_bytes,
      checksum_algorithm: status.checksum_algorithm,
      artifact_checksum: status.artifact_checksum,
      integrity_parts: status.integrity_parts,
    };
    invoke.mockResolvedValue({
      ok: true,
      download: {
        ...base,
        url:
          `https://attacker.example/storage/v1/object/sign/postshow-workspace-exports/` +
          `${workspaceId}/${requestId}/workspace.ndjson?token=signed&` +
          `download=${encodeURIComponent(status.filename)}`,
      },
    });
    await expect(createWorkspaceExportDownload(status)).rejects.toThrow(/untrusted/i);

    invoke.mockResolvedValue({
      ok: true,
      download: {
        ...base,
        url:
          `https://project-ref.supabase.co/storage/v1/object/sign/` +
          `postshow-workspace-exports/${workspaceId}/${requestId}/workspace.ndjson`,
      },
    });
    await expect(createWorkspaceExportDownload(status)).rejects.toThrow(/untrusted/i);

    invoke.mockResolvedValue({
      ok: true,
      download: {
        ...base,
        artifact_checksum: 'c'.repeat(64),
        url:
          `https://project-ref.supabase.co/storage/v1/object/sign/` +
          `postshow-workspace-exports/${workspaceId}/${requestId}/workspace.ndjson?` +
          `token=signed&download=${encodeURIComponent(status.filename)}`,
      },
    });
    await expect(createWorkspaceExportDownload(status)).rejects.toThrow(/inconsistent/i);

    invoke.mockResolvedValue({
      ok: true,
      download: {
        ...base,
        url:
          `https://project-ref.supabase.co/storage/v1/object/sign/` +
          `postshow-workspace-exports/${workspaceId}/${requestId}/workspace.ndjson?` +
          `token=signed&token=duplicate&download=${encodeURIComponent(status.filename)}`,
      },
    });
    await expect(createWorkspaceExportDownload(status)).rejects.toThrow(/untrusted/i);

    invoke.mockResolvedValue({
      ok: true,
      download: {
        ...base,
        url:
          `https://project-ref.supabase.co/storage/v1/object/sign/` +
          `postshow-workspace-exports/${workspaceId}/${requestId}/workspace.ndjson?` +
          `token=signed&download=${encodeURIComponent('substituted.ndjson')}&extra=1`,
      },
    });
    await expect(createWorkspaceExportDownload(status)).rejects.toThrow(/untrusted/i);
  });

  it('builds a portable integrity manifest without a bearer URL', () => {
    const manifest = workspaceExportIntegrityManifest(readyStatus());
    expect(manifest).toMatchObject({
      manifest_type: 'postshow_workspace_export_integrity',
      manifest_version: 1,
      request_id: requestId,
      artifact_checksum: artifactHash,
    });
    expect(JSON.stringify(manifest)).not.toContain('token=');
    expect(manifest.parts).toEqual([{ part_number: 1, byte_size: 128, sha256: partHash }]);
  });

  it('caps UI access at the contractual 24-hour retention boundary', () => {
    const status = readyStatus();
    expect(workspaceExportAccessDeadline(status)).toBe(Date.parse(status.ready_at!) + 86_400_000);
    expect(
      workspaceExportAccessDeadline({
        ...status,
        expires_at: '2027-07-21T10:00:02.000Z',
      })
    ).toBe(Date.parse(status.ready_at!) + 86_400_000);
  });
});
