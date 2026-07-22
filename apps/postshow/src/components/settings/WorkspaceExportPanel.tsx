import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorRow } from '@/components/page';
import { fetchPublicReleaseGates } from '@/lib/auth';
import { PostshowFunctionError } from '@/lib/functionClient';
import { usePageData } from '@/lib/usePageData';
import { SOURCE_CLI_COMMAND } from '@/lib/cli';
import {
  beginWorkspaceExport,
  cancelWorkspaceExport,
  createWorkspaceExportDownload,
  fetchCurrentWorkspaceExport,
  fetchWorkspaceExportStatus,
  workspaceExportAccessDeadline,
  workspaceExportIntegrityManifest,
  type WorkspaceExportState,
  type WorkspaceExportStatus,
} from '@/lib/workspaceExport';

interface PersistedExport {
  version: 1;
  requestId: string | null;
  beginKey: string;
  cancelKey: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATES: readonly WorkspaceExportState[] = [
  'queued',
  'snapshotting',
  'uploading',
  'finalizing',
  'canceling',
  'failing',
  'expiring',
];
const TERMINAL_STATES: readonly WorkspaceExportState[] = ['canceled', 'failed', 'expired'];
const CANCELLABLE_STATES: readonly WorkspaceExportState[] = [
  'queued',
  'snapshotting',
  'uploading',
  'finalizing',
  'ready',
];
const CLEANUP_STATES: readonly WorkspaceExportState[] = ['canceling', 'failing', 'expiring'];
const STATE_LABELS: Record<WorkspaceExportState, string> = {
  queued: 'Queued safely',
  snapshotting: 'Taking one consistent snapshot',
  uploading: 'Uploading to private storage',
  finalizing: 'Verifying the completed artifact',
  ready: 'Export ready',
  canceling: 'Removing the export',
  canceled: 'Export removed',
  failing: 'Cleaning up an incomplete export',
  failed: 'Export could not be completed',
  expiring: 'Removing the expired export',
  expired: 'Export expired and was removed',
};

function persistenceKey(workspaceId: string): string {
  return `postshow.workspace-export.${workspaceId}`;
}

function loadPersistedExport(workspaceId: string): PersistedExport | null {
  try {
    const raw = window.localStorage.getItem(persistenceKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(parsed).sort();
    if (
      keys.join(':') !== 'beginKey:cancelKey:requestId:version' ||
      parsed.version !== 1 ||
      typeof parsed.beginKey !== 'string' ||
      !UUID_RE.test(parsed.beginKey) ||
      (parsed.requestId !== null &&
        (typeof parsed.requestId !== 'string' || !UUID_RE.test(parsed.requestId))) ||
      (parsed.cancelKey !== null &&
        (typeof parsed.cancelKey !== 'string' || !UUID_RE.test(parsed.cancelKey)))
    ) {
      return null;
    }
    return {
      version: 1,
      requestId: parsed.requestId as string | null,
      beginKey: parsed.beginKey,
      cancelKey: parsed.cancelKey as string | null,
    };
  } catch {
    return null;
  }
}

function savePersistedExport(workspaceId: string, operation: PersistedExport): void {
  try {
    window.localStorage.setItem(persistenceKey(workspaceId), JSON.stringify(operation));
  } catch {
    // The current view still holds the replay keys. The server remains authoritative.
  }
}

function clearPersistedExport(workspaceId: string): void {
  try {
    window.localStorage.removeItem(persistenceKey(workspaceId));
  } catch {
    // There is no additional browser state to clear.
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function publicExportError(code: string | null): string {
  switch (code) {
    case null:
      return '';
    case 'record_too_large':
      return 'One workspace record exceeds the 4 MiB per-record export limit. Contact support with the request ID.';
    case 'artifact_too_large':
      return 'This workspace exceeds the 512 MiB export limit. Contact support with the request ID.';
    case 'workspace_unavailable':
      return 'The workspace changed before its snapshot could be sealed. Start a new export.';
    case 'deadline_yield':
      return 'The worker yielded safely and will continue automatically.';
    case 'provider_state_uncertain':
      return 'Storage returned an ambiguous result. Postshow is reading it back before continuing.';
    case 'storage_unavailable':
      return 'Private export storage is temporarily unavailable. Postshow will retry automatically.';
    case 'storage_contract_invalid':
      return 'Private export storage needs operator attention. No download was exposed.';
    default:
      return 'The export needs attention. Its bounded request ID is safe to share with support.';
  }
}

function triggerSignedDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    document.body.append(link);
    link.click();
  } catch {
    throw new Error('Workspace export could not be downloaded in this browser.');
  } finally {
    link.remove();
    link.removeAttribute('href');
  }
}

function triggerManifestDownload(status: WorkspaceExportStatus): string {
  const manifest = workspaceExportIntegrityManifest(status);
  const filename = `${status.filename}.integrity.json`;
  const blob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
  } catch {
    throw new Error('The integrity manifest could not be downloaded in this browser.');
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return filename;
}

function exportVerificationCommand(status: WorkspaceExportStatus): string {
  return `${SOURCE_CLI_COMMAND} export verify ${status.filename} ${status.filename}.integrity.json`;
}

function shouldPoll(status: WorkspaceExportStatus): boolean {
  if (ACTIVE_STATES.includes(status.state)) return true;
  return status.state === 'ready' && workspaceExportAccessDeadline(status) <= Date.now();
}

export function WorkspaceExportPanel({
  workspaceId,
  disabled = false,
}: {
  workspaceId: string;
  disabled?: boolean;
}) {
  const persisted = useRef(loadPersistedExport(workspaceId));
  const [requestId, setRequestId] = useState(persisted.current?.requestId ?? null);
  const [status, setStatus] = useState<WorkspaceExportStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [discoveryState, setDiscoveryState] = useState<
    'pending' | 'loading' | 'complete' | 'error'
  >(persisted.current?.requestId ? 'complete' : 'pending');
  const [discoveryError, setDiscoveryError] = useState('');
  const [discoveryRevision, setDiscoveryRevision] = useState(0);
  const statusGeneration = useRef(0);
  const discoveryGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const mutationInFlight = useRef(false);
  const forcePoll = useRef(false);
  const pollAttempts = useRef(0);
  const discoveryAttempts = useRef(0);
  const lastFingerprint = useRef('');
  const [pollRevision, setPollRevision] = useState(0);
  const prepareButtonRef = useRef<HTMLButtonElement>(null);
  const statusFocusRef = useRef<HTMLDivElement>(null);
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useRef<'status' | 'prepare' | 'cancel' | null>(null);
  const gatesFetcher = useCallback(() => fetchPublicReleaseGates(), []);
  const {
    data: releaseGates,
    loading: releaseGatesLoading,
    error: releaseGateError,
    reload: reloadReleaseGates,
  } = usePageData(gatesFetcher);

  const reschedulePoll = useCallback(() => {
    forcePoll.current = true;
    pollAttempts.current += 1;
    setPollRevision((revision) => revision + 1);
  }, []);

  const acceptStatus = useCallback(
    (next: WorkspaceExportStatus) => {
      if (next.workspace_id !== workspaceId) {
        throw new Error('Workspace export service returned a different workspace.');
      }
      const fingerprint = [
        next.state,
        next.uploaded_parts,
        next.part_count,
        next.error_code ?? '',
      ].join(':');
      if (fingerprint === lastFingerprint.current) pollAttempts.current += 1;
      else {
        lastFingerprint.current = fingerprint;
        pollAttempts.current = 0;
      }
      setStatus(next);
      setRequestId(next.request_id);
      if (next.state === 'canceled' || next.state === 'expired') {
        clearPersistedExport(workspaceId);
        persisted.current = null;
      } else if (persisted.current?.requestId !== next.request_id) {
        const saved: PersistedExport = {
          version: 1,
          requestId: next.request_id,
          beginKey: persisted.current?.beginKey ?? crypto.randomUUID(),
          cancelKey: null,
        };
        persisted.current = saved;
        savePersistedExport(workspaceId, saved);
      }
    },
    [workspaceId]
  );

  const discoverCurrent = useCallback(async () => {
    if (disabled || requestId || status || mutationInFlight.current) return;
    const generation = ++discoveryGeneration.current;
    setDiscoveryState('loading');
    setDiscoveryError('');
    try {
      const next = await fetchCurrentWorkspaceExport(workspaceId);
      if (generation !== discoveryGeneration.current) return;
      discoveryAttempts.current = 0;
      setDiscoveryState('complete');
      setError('');
      if (next) {
        acceptStatus(next);
        setNotice('Recovered the current export from protected server state.');
      }
    } catch (value) {
      if (generation !== discoveryGeneration.current) return;
      discoveryAttempts.current += 1;
      setDiscoveryState('error');
      setDiscoveryError(
        value instanceof Error ? value.message : 'Current export could not be checked.'
      );
    }
  }, [acceptStatus, disabled, requestId, status, workspaceId]);

  useEffect(() => {
    if (
      disabled ||
      requestId ||
      status ||
      discoveryState === 'complete' ||
      discoveryState === 'loading'
    )
      return;
    void discoverCurrent();
  }, [disabled, discoverCurrent, discoveryRevision, discoveryState, requestId, status]);

  useEffect(() => {
    if (disabled || requestId || status || discoveryState !== 'error') return;
    const delay = Math.min(15_000, 2500 * 1.45 ** discoveryAttempts.current);
    const timer = window.setTimeout(() => setDiscoveryRevision((revision) => revision + 1), delay);
    return () => window.clearTimeout(timer);
  }, [disabled, discoveryState, requestId, status]);

  useEffect(
    () => () => {
      discoveryGeneration.current += 1;
    },
    []
  );

  useEffect(() => {
    if (disabled || requestId || status) discoveryGeneration.current += 1;
    if (disabled && !requestId && !status) {
      setDiscoveryState('pending');
      setDiscoveryError('');
    }
  }, [disabled, requestId, status]);

  const refreshStatus = useCallback(async () => {
    if (!requestId || disabled) return;
    if (mutationInFlight.current) {
      reschedulePoll();
      return;
    }
    const mutation = mutationGeneration.current;
    const generation = ++statusGeneration.current;
    try {
      const next = await fetchWorkspaceExportStatus(requestId);
      if (generation !== statusGeneration.current || mutation !== mutationGeneration.current)
        return;
      acceptStatus(next);
      setError('');
    } catch (value) {
      if (generation !== statusGeneration.current || mutation !== mutationGeneration.current)
        return;
      let retryable = true;
      if (value instanceof PostshowFunctionError && value.status !== null && value.status === 404) {
        clearPersistedExport(workspaceId);
        persisted.current = null;
        setRequestId(null);
        setStatus(null);
        setDiscoveryState('pending');
        setDiscoveryRevision((revision) => revision + 1);
        retryable = false;
      }
      setError(value instanceof Error ? value.message : 'Export status could not be loaded.');
      if (retryable) reschedulePoll();
    }
  }, [acceptStatus, disabled, requestId, reschedulePoll, workspaceId]);

  useEffect(() => {
    if (requestId) void refreshStatus();
    return () => {
      statusGeneration.current += 1;
      mutationGeneration.current += 1;
      mutationInFlight.current = false;
    };
  }, [refreshStatus, requestId]);

  useEffect(() => {
    if (disabled || !requestId || (status !== null && !shouldPoll(status) && !forcePoll.current))
      return;
    forcePoll.current = false;
    const delay = Math.min(15_000, 2500 * 1.45 ** pollAttempts.current);
    const timer = window.setTimeout(() => void refreshStatus(), delay);
    return () => window.clearTimeout(timer);
  }, [disabled, pollRevision, refreshStatus, requestId, status]);

  useEffect(() => {
    if (disabled || status?.state !== 'ready' || !status.expires_at) return;
    const expiresIn = workspaceExportAccessDeadline(status) - Date.now();
    if (expiresIn <= 0) return;
    const timer = window.setTimeout(
      () => void refreshStatus(),
      Math.min(24 * 60 * 60 * 1000, expiresIn + 1000)
    );
    return () => window.clearTimeout(timer);
  }, [disabled, refreshStatus, status]);

  useEffect(() => {
    if (disabled) return;
    const refresh = () => {
      if (requestId) void refreshStatus();
      else {
        setDiscoveryState('pending');
        setDiscoveryRevision((revision) => revision + 1);
      }
    };
    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [disabled, refreshStatus, requestId]);

  useEffect(() => {
    const target = focusAfterRender.current;
    if (target === 'prepare' && discoveryState !== 'complete') return;
    const targetNode =
      target === 'status'
        ? statusFocusRef.current
        : target === 'prepare'
          ? prepareButtonRef.current
          : target === 'cancel'
            ? cancelTriggerRef.current
            : null;
    if (targetNode) {
      focusAfterRender.current = null;
      targetNode.focus();
      return;
    }
    if (confirmCancel) {
      confirmCancelRef.current?.focus();
    }
  }, [confirmCancel, discoveryState, status]);

  const newBeginsEnabled =
    !releaseGatesLoading && !releaseGateError && releaseGates?.workspace_export === true;

  async function startExport() {
    if (busy || disabled || requestId || status || !newBeginsEnabled) return;
    const mutation = ++mutationGeneration.current;
    statusGeneration.current += 1;
    mutationInFlight.current = true;
    setBusy('begin');
    setError('');
    setDiscoveryError('');
    setNotice('Checking protected server state before starting a new export…');
    setConfirmCancel(false);
    try {
      const current = await fetchCurrentWorkspaceExport(workspaceId);
      if (mutation !== mutationGeneration.current) return;
      if (current) {
        focusAfterRender.current = 'status';
        setDiscoveryState('complete');
        acceptStatus(current);
        setNotice('Recovered the current export from protected server state.');
        return;
      }
      const operation = persisted.current ?? {
        version: 1 as const,
        requestId: null,
        beginKey: crypto.randomUUID(),
        cancelKey: null,
      };
      persisted.current = operation;
      savePersistedExport(workspaceId, operation);
      setNotice('Requesting a consistent, secret-free workspace snapshot…');
      const next = await beginWorkspaceExport(workspaceId, operation.beginKey);
      if (mutation !== mutationGeneration.current) return;
      const saved: PersistedExport = {
        ...operation,
        requestId: next.request_id,
      };
      persisted.current = saved;
      savePersistedExport(workspaceId, saved);
      focusAfterRender.current = 'status';
      acceptStatus(next);
      setNotice('Export accepted. You can leave this page; progress is durable.');
    } catch (value) {
      if (mutation !== mutationGeneration.current) return;
      setNotice('');
      setError(value instanceof Error ? value.message : 'Workspace export could not start.');
      setDiscoveryState('pending');
      setDiscoveryRevision((revision) => revision + 1);
    } finally {
      if (mutation === mutationGeneration.current) mutationInFlight.current = false;
      setBusy('');
    }
  }

  async function removeExport() {
    if (!status || busy || disabled || !confirmCancel || !CANCELLABLE_STATES.includes(status.state))
      return;
    const mutation = ++mutationGeneration.current;
    statusGeneration.current += 1;
    mutationInFlight.current = true;
    const operation: PersistedExport = persisted.current ?? {
      version: 1,
      requestId: status.request_id,
      beginKey: crypto.randomUUID(),
      cancelKey: null,
    };
    const saved: PersistedExport = {
      ...operation,
      requestId: status.request_id,
      cancelKey: operation.cancelKey ?? crypto.randomUUID(),
    };
    persisted.current = saved;
    savePersistedExport(workspaceId, saved);
    setBusy('cancel');
    setError('');
    setNotice('Starting private export removal and provider-absence verification…');
    try {
      const next = await cancelWorkspaceExport(status.request_id, saved.cancelKey!);
      if (mutation !== mutationGeneration.current) return;
      focusAfterRender.current = 'status';
      acceptStatus(next);
      setConfirmCancel(false);
      setNotice(
        next.state === 'canceled'
          ? 'Export removed and provider absence verified. A bearer URL issued before removal can remain valid for no more than its one-minute lifetime if it raced cleanup.'
          : 'Removal accepted. Cleanup will continue even if you leave this page.'
      );
    } catch (value) {
      if (mutation !== mutationGeneration.current) return;
      setNotice('');
      setError(value instanceof Error ? value.message : 'Workspace export could not be removed.');
      reschedulePoll();
    } finally {
      if (mutation === mutationGeneration.current) mutationInFlight.current = false;
      setBusy('');
    }
  }

  async function downloadExport() {
    if (status?.state !== 'ready' || busy || disabled) return;
    setBusy('download');
    setError('');
    setNotice('Authorizing a private one-minute download…');
    try {
      const download = await createWorkspaceExportDownload(status);
      triggerSignedDownload(download.url, download.filename);
      setNotice(
        `Download started. Save the integrity manifest and verify ${download.artifact_checksum}.`
      );
    } catch (value) {
      setNotice('');
      setError(
        value instanceof Error ? value.message : 'Workspace export could not be downloaded.'
      );
      void refreshStatus();
    } finally {
      setBusy('');
    }
  }

  async function copyManifest() {
    if (status?.state !== 'ready' || busy || disabled) return;
    setBusy('copy-manifest');
    setError('');
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this browser.');
      }
      await navigator.clipboard.writeText(
        `${JSON.stringify(workspaceExportIntegrityManifest(status), null, 2)}\n`
      );
      setNotice('Integrity manifest copied to the clipboard.');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Integrity manifest could not be copied.');
    } finally {
      setBusy('');
    }
  }

  async function copyVerificationCommand() {
    if (status?.state !== 'ready' || busy || disabled) return;
    setBusy('copy-verification-command');
    setError('');
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this browser.');
      }
      await navigator.clipboard.writeText(exportVerificationCommand(status));
      setNotice('Verification command copied to the clipboard.');
    } catch (value) {
      setError(
        value instanceof Error ? value.message : 'Verification command could not be copied.'
      );
    } finally {
      setBusy('');
    }
  }

  function downloadManifest() {
    if (status?.state !== 'ready' || busy || disabled) return;
    setError('');
    try {
      const filename = triggerManifestDownload(status);
      setNotice(`Integrity manifest downloaded as ${filename}.`);
    } catch (value) {
      setError(
        value instanceof Error ? value.message : 'Integrity manifest could not be downloaded.'
      );
    }
  }

  function prepareAnotherExport() {
    focusAfterRender.current = 'prepare';
    clearPersistedExport(workspaceId);
    persisted.current = null;
    statusGeneration.current += 1;
    mutationGeneration.current += 1;
    mutationInFlight.current = false;
    setRequestId(null);
    setStatus(null);
    setError('');
    setNotice('');
    setConfirmCancel(false);
    setDiscoveryState('pending');
    setDiscoveryError('');
    setDiscoveryRevision((revision) => revision + 1);
    pollAttempts.current = 0;
    lastFingerprint.current = '';
  }

  const downloadAvailable =
    status?.state === 'ready' && workspaceExportAccessDeadline(status) > Date.now();
  const checkingForCurrent = requestId === null && status === null && discoveryState !== 'complete';
  const canStartExport =
    !disabled && !requestId && discoveryState === 'complete' && newBeginsEnabled && busy === '';
  const progress = status?.part_count
    ? Math.min(100, Math.round((status.uploaded_parts / status.part_count) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="m-0 font-public-sans text-[14px] font-medium text-night-fg">
            Export your data
          </h3>
          <p className="m-0 mt-1 max-w-[68ch] font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
            Create a complete customer-visible workspace snapshot as NDJSON: settings, members,
            secret-free connector metadata, product data, billing and usage history, and audit
            events. Credentials, bearer tokens, internal provider routing IDs, and worker claims are
            excluded; user-configured connector targets remain visible.
          </p>
          <p className="m-0 mt-2 max-w-[68ch] font-public-sans text-[11px] leading-[1.5] text-night-fg-3">
            Exports stream from private storage instead of loading into this browser and are limited
            to 512 MiB. Download access expires 24 hours after an export becomes ready; deletion
            then starts automatically and is retried until storage confirms the artifact is absent.
          </p>
        </div>
        {!status ? (
          <button
            ref={prepareButtonRef}
            type="button"
            onClick={() => void startExport()}
            disabled={!canStartExport}
            className="ps-btn-ghost shrink-0"
          >
            {busy === 'begin'
              ? 'Requesting…'
              : requestId
                ? 'Checking export status…'
                : checkingForCurrent
                  ? 'Checking for existing export…'
                  : releaseGatesLoading
                    ? 'Checking export availability…'
                    : releaseGateError
                      ? 'Export availability unavailable'
                      : releaseGates?.workspace_export === false
                        ? 'New exports paused'
                        : persisted.current
                          ? 'Resume export request'
                          : 'Prepare export'}
          </button>
        ) : null}
      </div>

      {disabled && !status ? (
        <p className="m-0 font-public-sans text-[12px] leading-[1.5] text-night-fg-3">
          Export actions are unavailable while workspace deletion is active. Any accepted export
          cleanup continues on the server.
        </p>
      ) : null}

      {!disabled && !status && !requestId && discoveryError ? (
        <div className="flex flex-col items-start gap-2">
          <ErrorRow message={discoveryError} />
          <button
            type="button"
            onClick={() => {
              setDiscoveryState('pending');
              setDiscoveryRevision((revision) => revision + 1);
            }}
            disabled={disabled || discoveryState === 'loading'}
            className="ps-btn-ghost"
          >
            Retry export recovery
          </button>
        </div>
      ) : null}

      {!disabled && !status && !requestId && discoveryState === 'complete' && releaseGateError ? (
        <div className="flex flex-col items-start gap-2">
          <ErrorRow message="New export availability could not be verified. Existing export recovery remains available." />
          <button type="button" onClick={reloadReleaseGates} className="ps-btn-ghost">
            Retry availability check
          </button>
        </div>
      ) : null}

      {!disabled &&
      !status &&
      !requestId &&
      discoveryState === 'complete' &&
      !releaseGateError &&
      releaseGates?.workspace_export === false ? (
        <p className="m-0 font-public-sans text-[12px] leading-[1.5] text-night-fg-3" role="status">
          New export creation is temporarily paused. Recovery, download, and removal of an existing
          export remain available.
        </p>
      ) : null}

      {status ? (
        <div className="rounded-md border border-night-4 bg-night-2 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div
              ref={statusFocusRef}
              role="status"
              aria-label="Workspace export status"
              aria-live="polite"
              tabIndex={-1}
            >
              <p className="m-0 font-public-sans text-[13px] font-medium text-night-fg">
                {STATE_LABELS[status.state]}
              </p>
              <p className="m-0 mt-1 font-public-sans text-[11px] text-night-fg-3">
                Request <span className="font-public-mono">{status.request_id}</span>
              </p>
              {status.snapshot_at ? (
                <p className="m-0 mt-1 font-public-sans text-[11px] text-night-fg-3">
                  Snapshot {formatDate(status.snapshot_at)} · {status.record_count.toLocaleString()}{' '}
                  records · {formatBytes(status.artifact_bytes)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              disabled={busy !== '' || disabled}
              className="ps-btn-ghost shrink-0"
            >
              Refresh
            </button>
          </div>

          {status.part_count > 0 && ACTIVE_STATES.includes(status.state) ? (
            <div className="mt-3">
              <div className="mb-1 flex justify-between font-public-sans text-[10px] text-night-fg-3">
                <span>Verified upload progress</span>
                <span>
                  {status.uploaded_parts}/{status.part_count} parts
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-night-4"
                role="progressbar"
                aria-label="Workspace export upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div className="h-full bg-signal" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : null}

          {status.error_code ? (
            <p className="m-0 mt-3 font-public-sans text-[12px] leading-[1.5] text-warn">
              {publicExportError(status.error_code)}
            </p>
          ) : null}

          {status.state === 'ready' && status.artifact_checksum ? (
            <div className="mt-4 rounded-md border border-signal/50 bg-night-1 p-3">
              <p className="m-0 font-public-sans text-[12px] font-medium text-night-fg">
                Private download available until {formatDate(status.expires_at)}
              </p>
              <p className="m-0 mt-1 font-public-sans text-[11px] leading-[1.5] text-night-fg-2">
                The signed download URL is created only when requested and expires within one
                minute. Postshow never stores that URL in browser storage. A URL already issued can
                remain usable for that bounded period unless its storage object is removed first.
              </p>
              <dl className="m-0 mt-3 grid gap-x-3 gap-y-1 font-public-sans text-[11px] sm:grid-cols-[140px_1fr]">
                <dt className="text-night-fg-3">Artifact SHA-256 tree</dt>
                <dd className="m-0 break-all font-public-mono text-[10px] text-night-fg-2">
                  {status.artifact_checksum}
                </dd>
                <dt className="text-night-fg-3">Integrity parts</dt>
                <dd className="m-0 text-night-fg-2">{status.part_count.toLocaleString()}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void downloadExport()}
                  disabled={!downloadAvailable || busy !== '' || disabled}
                  className="ps-btn-primary"
                >
                  {busy === 'download' ? 'Authorizing…' : 'Download NDJSON'}
                </button>
                <button
                  type="button"
                  onClick={downloadManifest}
                  disabled={busy !== '' || disabled}
                  className="ps-btn-ghost"
                >
                  Download integrity manifest
                </button>
                <button
                  type="button"
                  onClick={() => void copyManifest()}
                  disabled={busy !== '' || disabled}
                  className="ps-btn-ghost"
                >
                  {busy === 'copy-manifest' ? 'Copying…' : 'Copy integrity manifest'}
                </button>
              </div>
              <div className="mt-3 border-t border-night-4 pt-3">
                <p className="m-0 font-public-sans text-[11px] leading-[1.5] text-night-fg-2">
                  After downloading both files, verify them locally. The command is{' '}
                  <code className="font-public-mono text-[10px] text-night-fg">
                    {SOURCE_CLI_COMMAND} export verify &lt;artifact&gt; &lt;manifest&gt;
                  </code>
                  .
                </p>
                <code className="mt-2 block break-all rounded-sm bg-night-2 p-2 font-public-mono text-[10px] leading-[1.5] text-night-fg">
                  {exportVerificationCommand(status)}
                </code>
                <button
                  type="button"
                  onClick={() => void copyVerificationCommand()}
                  disabled={busy !== '' || disabled}
                  className="ps-btn-ghost mt-2"
                >
                  {busy === 'copy-verification-command' ? 'Copying…' : 'Copy verification command'}
                </button>
              </div>
            </div>
          ) : null}

          {disabled ? (
            <p className="m-0 mt-3 font-public-sans text-[12px] leading-[1.5] text-night-fg-3">
              Export actions are unavailable while workspace deletion is active. Any accepted export
              cleanup continues on the server.
            </p>
          ) : TERMINAL_STATES.includes(status.state) ? (
            <button
              type="button"
              onClick={prepareAnotherExport}
              disabled={busy !== '' || disabled}
              className="ps-btn-ghost mt-3"
            >
              Prepare another export
            </button>
          ) : CANCELLABLE_STATES.includes(status.state) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {confirmCancel ? (
                <>
                  <button
                    ref={confirmCancelRef}
                    type="button"
                    onClick={() => void removeExport()}
                    disabled={busy !== ''}
                    className="ps-btn-ghost !border-bad/60 !text-bad"
                  >
                    {busy === 'cancel' ? 'Removing…' : 'Confirm remove export'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      focusAfterRender.current = 'cancel';
                      setConfirmCancel(false);
                    }}
                    disabled={busy !== ''}
                    className="ps-btn-ghost"
                  >
                    Keep export
                  </button>
                </>
              ) : (
                <button
                  ref={cancelTriggerRef}
                  type="button"
                  onClick={() => {
                    setConfirmCancel(true);
                    setError('');
                    setNotice(
                      status.state === 'ready'
                        ? 'Start removal of the private server copy. A URL already issued can remain usable for up to one minute if it races cleanup.'
                        : 'Canceling stops this export and removes any uploaded parts.'
                    );
                  }}
                  disabled={busy !== ''}
                  className="ps-btn-ghost !border-bad/60 !text-bad"
                >
                  {status.state === 'ready' ? 'Start removal' : 'Cancel export'}
                </button>
              )}
            </div>
          ) : CLEANUP_STATES.includes(status.state) ? (
            <p className="m-0 mt-3 font-public-sans text-[12px] leading-[1.5] text-night-fg-3">
              Server-side cleanup is already in progress. Refresh will show the verified terminal
              result; no additional cancellation is accepted in this state.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorRow message={error} /> : null}
      {notice ? (
        <p
          className="m-0 font-public-sans text-[12px] text-signal"
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
