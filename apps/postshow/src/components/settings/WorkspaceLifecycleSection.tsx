import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ErrorRow, Section } from '@/components/page';
import { WorkspaceExportPanel } from '@/components/settings/WorkspaceExportPanel';
import { fetchPublicReleaseGates } from '@/lib/auth';
import { clearIdempotencyKey, idempotencyKey } from '@/lib/idempotency';
import { PostshowFunctionError } from '@/lib/functionClient';
import { destructiveAccessToken, REAUTHENTICATION_GUIDANCE } from '@/lib/destructiveAuth';
import { usePageData } from '@/lib/usePageData';
import {
  beginWorkspaceDeletion,
  cancelWorkspaceDeletion,
  fetchCurrentWorkspaceDeletion,
  fetchRequesterWorkspaceDeletions,
  fetchWorkspaceDeletionStatus,
  type WorkspaceDeletionProgress,
  type WorkspaceDeletionReceipt,
  type WorkspaceDeletionStatus,
} from '@/lib/workspaceLifecycle';
import { useWorkspace } from '@/state/WorkspaceContext';

interface PersistedDeletion {
  requestId: string | null;
  beginKey: string | null;
}

interface DeletionRecoveryCandidate {
  workspaceId: string;
  requestId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function recoveryIndexKey(actorId: string): string {
  return `postshow.workspace-deletion-recovery.v1.${actorId}`;
}

function persistenceKey(actorId: string, workspaceId: string): string {
  return `postshow.workspace-deletion.${actorId}.${workspaceId}`;
}

function loadPersistedDeletion(actorId: string, workspaceId: string): PersistedDeletion | null {
  try {
    const raw = window.localStorage.getItem(persistenceKey(actorId, workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { requestId?: unknown; beginKey?: unknown };
    if (
      parsed.beginKey !== null &&
      (typeof parsed.beginKey !== 'string' || !UUID_RE.test(parsed.beginKey))
    )
      return null;
    if (
      parsed.requestId !== null &&
      parsed.requestId !== undefined &&
      (typeof parsed.requestId !== 'string' || !UUID_RE.test(parsed.requestId))
    )
      return null;
    const requestId = parsed.requestId ?? null;
    if (requestId === null && parsed.beginKey === null) return null;
    return { requestId, beginKey: parsed.beginKey };
  } catch {
    return null;
  }
}

function loadRecoveryCandidates(actorId: string): DeletionRecoveryCandidate[] {
  try {
    const raw = window.localStorage.getItem(recoveryIndexKey(actorId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: DeletionRecoveryCandidate[] = [];
    const seen = new Set<string>();
    for (const value of parsed.slice(0, 10)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const candidate = value as { workspaceId?: unknown; requestId?: unknown };
      if (
        typeof candidate.workspaceId !== 'string' ||
        !UUID_RE.test(candidate.workspaceId) ||
        typeof candidate.requestId !== 'string' ||
        !UUID_RE.test(candidate.requestId) ||
        seen.has(candidate.requestId)
      )
        continue;
      seen.add(candidate.requestId);
      result.push({ workspaceId: candidate.workspaceId, requestId: candidate.requestId });
    }
    return result;
  } catch {
    return [];
  }
}

function saveRecoveryCandidates(actorId: string, candidates: DeletionRecoveryCandidate[]): void {
  try {
    const key = recoveryIndexKey(actorId);
    if (candidates.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(candidates.slice(0, 10)));
  } catch {
    // Recovery remains available in the current workspace view.
  }
}

function rememberRecoveryCandidate(actorId: string, workspaceId: string, requestId: string): void {
  if (!UUID_RE.test(workspaceId) || !UUID_RE.test(requestId)) return;
  const current = loadRecoveryCandidates(actorId);
  saveRecoveryCandidates(actorId, [
    { workspaceId, requestId },
    ...current.filter((candidate) => candidate.requestId !== requestId),
  ]);
}

function forgetRecoveryCandidate(actorId: string, workspaceId: string): void {
  saveRecoveryCandidates(
    actorId,
    loadRecoveryCandidates(actorId).filter((candidate) => candidate.workspaceId !== workspaceId)
  );
}

function savePersistedDeletion(
  actorId: string,
  workspaceId: string,
  value: PersistedDeletion
): void {
  try {
    window.localStorage.setItem(persistenceKey(actorId, workspaceId), JSON.stringify(value));
    if (value.requestId) rememberRecoveryCandidate(actorId, workspaceId, value.requestId);
  } catch {
    // The current page still holds enough state to finish or cancel the request.
  }
}

function clearPersistedDeletion(actorId: string, workspaceId: string): void {
  try {
    window.localStorage.removeItem(persistenceKey(actorId, workspaceId));
    forgetRecoveryCandidate(actorId, workspaceId);
  } catch {
    // Nothing else to clear.
  }
}

function triggerDownload(
  file: { blob: Blob; fileName: string },
  failureMessage = 'Workspace export could not be downloaded in this browser.'
): void {
  let url: string | null = null;
  const link = document.createElement('a');
  try {
    url = URL.createObjectURL(file.blob);
    link.href = url;
    link.download = file.fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
  } catch {
    throw new Error(failureMessage);
  } finally {
    link.remove();
    if (url) {
      const completedUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(completedUrl), 1000);
    }
  }
}

const PROGRESS_LABELS: Record<WorkspaceDeletionProgress, string> = {
  queued: 'Queued safely',
  waiting_for_quiescence: 'Waiting for running work and usage to settle',
  provider_cleanup: 'Closing billing-provider resources',
  checkout_closed: 'Open checkout closed',
  schedule_released: 'Scheduled billing change released',
  subscription_canceled: 'Subscription canceled',
  invoice_items_cleared: 'Pending invoice items cleared',
  metronome_ended: 'Enterprise billing contract ended',
  finalizing: 'Removing workspace data and secrets',
  completed: 'Deletion complete',
};

function publicDeletionError(code: string | null): string {
  switch (code) {
    case null:
      return '';
    case 'waiting_for_quiescence':
      return 'Running work or usage is still settling. The worker will retry automatically.';
    case 'deadline_yield':
      return 'The worker yielded safely before its deadline and will continue automatically.';
    case 'provider_unavailable':
      return 'A billing provider is temporarily unavailable. No duplicate cleanup will be attempted.';
    case 'provider_state_uncertain':
      return 'The provider response was ambiguous. Postshow will read it back before continuing.';
    default:
      return 'Deletion needs attention. Your workspace remains closed to new work and can be retried safely.';
  }
}

function deletionActionError(error: unknown, fallback: string): string {
  if (error instanceof PostshowFunctionError && error.code === 'reauthentication_required') {
    return REAUTHENTICATION_GUIDANCE;
  }
  return error instanceof Error ? error.message : fallback;
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

function deletionReceiptDocument(status: WorkspaceDeletionStatus): Record<string, unknown> {
  return {
    receipt_type: 'postshow_workspace_deletion',
    request_id: status.request_id,
    requested_at: status.requested_at,
    completed_at: status.completed_at,
    receipt_available_until: status.receipt_available_until,
    ...status.completion_receipt,
  };
}

function ReceiptHash({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-t border-night-4 py-2 first:border-0 first:pt-0 sm:grid-cols-[170px_1fr]">
      <span className="font-public-sans text-[11px] text-night-fg-3">{label}</span>
      <code className="break-all font-public-mono text-[10px] leading-[1.5] text-night-fg-2">
        {value}
      </code>
    </div>
  );
}

function FreshAuthPasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex max-w-[460px] flex-col gap-1">
      <span className="ps-label">
        Password (optional with a fresh passwordless, OAuth, SSO, or MFA sign-in)
      </span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="current-password"
        className="ps-input"
      />
      <span className="font-public-sans text-[11px] leading-[1.45] text-night-fg-3">
        Leave this blank to use your current interactive sign-in. A new deletion is accepted only
        when the server verifies a sign-in method from the last 10 minutes.
      </span>
    </label>
  );
}

function DeletionReceiptDetails({ receipt }: { receipt: WorkspaceDeletionReceipt }) {
  return (
    <details className="mt-3 rounded-sm border border-night-4 bg-night-1 px-3 py-2">
      <summary className="cursor-pointer font-public-sans text-[12px] font-medium text-night-fg">
        Verification hashes and counts
      </summary>
      <div className="mt-3">
        <div className="grid gap-1 pb-2 sm:grid-cols-[170px_1fr]">
          <span className="font-public-sans text-[11px] text-night-fg-3">Receipt version</span>
          <span className="font-public-mono text-[10px] text-night-fg-2">{receipt.version}</span>
        </div>
        <div className="grid gap-1 border-t border-night-4 py-2 sm:grid-cols-[170px_1fr]">
          <span className="font-public-sans text-[11px] text-night-fg-3">Completed generation</span>
          <span className="font-public-mono text-[10px] text-night-fg-2">
            {receipt.completed_generation}
          </span>
        </div>
        <div className="grid gap-1 border-t border-night-4 py-2 sm:grid-cols-[170px_1fr]">
          <span className="font-public-sans text-[11px] text-night-fg-3">Verified targets</span>
          <span className="font-public-mono text-[10px] text-night-fg-2">
            {receipt.target_count}
          </span>
        </div>
        <ReceiptHash label="Provider target hash" value={receipt.provider_target_hash} />
        <ReceiptHash label="Target manifest hash" value={receipt.target_manifest_hash} />
        <ReceiptHash label="Usage ledger hash" value={receipt.usage_ledger_hash} />
        <ReceiptHash label="Outcome hash" value={receipt.outcome_hash} />
      </div>
    </details>
  );
}

interface RecoveredDeletion {
  workspaceId: string;
  workspaceLabel: string;
  status: WorkspaceDeletionStatus;
}

interface DeletionRecoveryView {
  scope: string;
  deletions: RecoveredDeletion[];
  shouldPoll: boolean;
  truncated: boolean;
  error: string;
}

function receiptIsAvailable(status: WorkspaceDeletionStatus): boolean {
  if (
    status.state !== 'completed' ||
    status.completion_receipt === null ||
    status.receipt_available_until === null
  )
    return false;
  return new Date(status.receipt_available_until).valueOf() > Date.now();
}

function receiptUnavailable(error: unknown): boolean {
  return error instanceof PostshowFunctionError && error.status !== null && error.status === 404;
}

/**
 * Keeps deletion progress, cancellation, and completed receipts available after a deleting
 * workspace leaves the membership list. Requester-scoped server discovery is authoritative;
 * actor-scoped browser pointers only supplement it during transient discovery failures.
 */
export function DeletionReceiptRecovery() {
  const { session, workspace, workspaceLoading } = useWorkspace();
  const actorId = session?.user.id ?? null;
  const currentWorkspaceId = workspace?.id ?? null;
  const scope = `${actorId ?? 'signed-out'}:${workspaceLoading ? 'loading' : (currentWorkspaceId ?? 'no-workspace')}`;
  const [view, setView] = useState<DeletionRecoveryView | null>(null);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState('');
  const refreshGeneration = useRef(0);
  const dismissedRequestIds = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    if (!actorId || workspaceLoading) {
      setView(null);
      return;
    }

    const candidates = loadRecoveryCandidates(actorId).filter(
      (candidate) => candidate.workspaceId !== currentWorkspaceId
    );
    const deletions = new Map<string, RecoveredDeletion>();
    let truncated = false;
    let discoveryFailed = false;
    let pointerCheckFailed = false;

    try {
      const current = await fetchRequesterWorkspaceDeletions();
      if (generation !== refreshGeneration.current) return;
      truncated = current.truncated;
      for (const entry of current.requests) {
        const status = entry.request;
        if (
          entry.workspace_id === currentWorkspaceId ||
          dismissedRequestIds.current.has(status.request_id)
        )
          continue;
        if (status.state === 'canceled') {
          clearPersistedDeletion(actorId, entry.workspace_id);
          continue;
        }
        if (status.state === 'completed' && !receiptIsAvailable(status)) {
          clearPersistedDeletion(actorId, entry.workspace_id);
          continue;
        }
        deletions.set(status.request_id, {
          workspaceId: entry.workspace_id,
          workspaceLabel: entry.workspace_label,
          status,
        });
        const saved: PersistedDeletion = {
          requestId: status.request_id,
          beginKey: loadPersistedDeletion(actorId, entry.workspace_id)?.beginKey ?? null,
        };
        savePersistedDeletion(actorId, entry.workspace_id, saved);
      }
    } catch {
      if (generation !== refreshGeneration.current) return;
      discoveryFailed = true;
    }

    await Promise.all(
      candidates.map(async (candidate) => {
        if (
          deletions.has(candidate.requestId) ||
          dismissedRequestIds.current.has(candidate.requestId)
        )
          return;
        try {
          const status = await fetchWorkspaceDeletionStatus(candidate.requestId);
          if (generation !== refreshGeneration.current) return;
          if (status.state === 'canceled') {
            clearPersistedDeletion(actorId, candidate.workspaceId);
          } else if (status.state === 'completed' && !receiptIsAvailable(status)) {
            clearPersistedDeletion(actorId, candidate.workspaceId);
          } else {
            deletions.set(status.request_id, {
              workspaceId: candidate.workspaceId,
              workspaceLabel: `Workspace ${candidate.workspaceId.slice(0, 8)}…`,
              status,
            });
          }
        } catch (error) {
          if (generation !== refreshGeneration.current) return;
          if (receiptUnavailable(error)) clearPersistedDeletion(actorId, candidate.workspaceId);
          else pointerCheckFailed = true;
        }
      })
    );
    if (generation !== refreshGeneration.current) return;

    const recovered = [...deletions.values()].sort((left, right) =>
      right.status.requested_at.localeCompare(left.status.requested_at)
    );
    setView({
      scope,
      deletions: recovered,
      shouldPoll: recovered.some(
        (entry) => !['completed', 'canceled', 'dead_letter'].includes(entry.status.state)
      ),
      truncated,
      error: discoveryFailed
        ? 'Protected deletion recovery could not be loaded. Saved pointers were retained; retry when you are online.'
        : pointerCheckFailed
          ? 'A saved deletion pointer could not be checked. It was retained for a later retry.'
          : '',
    });
  }, [actorId, currentWorkspaceId, scope, workspaceLoading]);

  useEffect(() => {
    setBusy('');
    setActionError('');
    setNotice('');
    setConfirmClear('');
    dismissedRequestIds.current.clear();
    void refresh();
    return () => {
      refreshGeneration.current += 1;
    };
  }, [refresh]);

  const currentView = view?.scope === scope ? view : null;

  useEffect(() => {
    if (!currentView?.shouldPoll) return;
    const timer = window.setTimeout(() => void refresh(), 12_000);
    return () => window.clearTimeout(timer);
  }, [currentView, refresh]);

  useEffect(() => {
    if (!actorId) return;
    const onFocus = () => void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [actorId, refresh]);

  useEffect(() => {
    const completed = currentView?.deletions.filter((entry) => receiptIsAvailable(entry.status));
    if (!completed?.length) return;
    const earliestExpiration = Math.min(
      ...completed.map((entry) => new Date(entry.status.receipt_available_until ?? 0).valueOf())
    );
    const delay = Math.min(24 * 60 * 60 * 1000, Math.max(0, earliestExpiration - Date.now() + 25));
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [currentView?.deletions, refresh]);

  async function copyRecoveredReceipt(entry: RecoveredDeletion) {
    if (busy || !receiptIsAvailable(entry.status)) return;
    setBusy(`copy:${entry.status.request_id}`);
    setActionError('');
    setNotice('');
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this browser.');
      }
      await navigator.clipboard.writeText(
        `${JSON.stringify(deletionReceiptDocument(entry.status), null, 2)}\n`
      );
      setNotice('Deletion receipt copied to the clipboard.');
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Deletion receipt could not be copied.'
      );
    } finally {
      setBusy('');
    }
  }

  function downloadRecoveredReceipt(entry: RecoveredDeletion) {
    if (busy || !receiptIsAvailable(entry.status)) return;
    const fileName = `postshow-deletion-receipt-${entry.status.request_id}.json`;
    setBusy(`download:${entry.status.request_id}`);
    setActionError('');
    setNotice('');
    try {
      triggerDownload(
        {
          blob: new Blob([`${JSON.stringify(deletionReceiptDocument(entry.status), null, 2)}\n`], {
            type: 'application/json;charset=utf-8',
          }),
          fileName,
        },
        'Deletion receipt could not be downloaded in this browser.'
      );
      setNotice(`Deletion receipt downloaded as ${fileName}.`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Deletion receipt could not be downloaded.'
      );
    } finally {
      setBusy('');
    }
  }

  function clearRecoveredReceipt(entry: RecoveredDeletion) {
    if (!actorId || confirmClear !== entry.status.request_id || !receiptIsAvailable(entry.status))
      return;
    clearPersistedDeletion(actorId, entry.workspaceId);
    dismissedRequestIds.current.add(entry.status.request_id);
    setConfirmClear('');
    setActionError('');
    setNotice('');
    setView((current) =>
      current?.scope === scope
        ? {
            ...current,
            deletions: current.deletions.filter(
              (candidate) => candidate.status.request_id !== entry.status.request_id
            ),
          }
        : current
    );
  }

  async function cancelRecoveredDeletion(entry: RecoveredDeletion) {
    if (!actorId || !entry.status.can_cancel || busy) return;
    const scope = `${actorId}.${entry.workspaceId}.delete-cancel.${entry.status.request_id}`;
    setBusy(`cancel:${entry.status.request_id}`);
    setActionError('');
    setNotice('Canceling before provider cleanup begins…');
    try {
      const next = await cancelWorkspaceDeletion(entry.status.request_id, idempotencyKey(scope));
      clearIdempotencyKey(scope);
      if (next.state === 'canceled') {
        clearPersistedDeletion(actorId, entry.workspaceId);
        setNotice('Workspace deletion canceled. The workspace can become active again.');
      }
      await refresh();
    } catch (error) {
      setNotice('');
      setActionError(error instanceof Error ? error.message : 'Deletion could not be canceled.');
    } finally {
      setBusy('');
    }
  }

  if (
    !actorId ||
    workspaceLoading ||
    !currentView ||
    (currentView.deletions.length === 0 && !currentView.error)
  ) {
    return null;
  }

  return (
    <aside
      className="fixed left-3 right-3 top-3 z-[90] max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-lg border border-night-4 bg-night-0 p-4 text-night-fg shadow-2xl sm:left-auto sm:w-[470px]"
      aria-labelledby="deletion-recovery-title"
    >
      <h2
        id="deletion-recovery-title"
        className="m-0 font-public-sans text-[14px] font-medium text-night-fg"
      >
        {currentView.deletions.some((entry) => entry.status.state !== 'completed')
          ? 'Workspace deletion recovery'
          : 'Saved deletion receipt'}
      </h2>
      <p className="m-0 mt-1 font-public-sans text-[12px] leading-[1.5] text-night-fg-2">
        Postshow loaded these requests from protected, requester-scoped server state after you
        signed in. Browser pointers are supplemental and never authorize an action.
      </p>

      {currentView.deletions.map((entry) => {
        const requestId = entry.status.request_id;
        const receipt = entry.status.completion_receipt;
        return (
          <section key={requestId} className="mt-4 border-t border-night-4 pt-4">
            <h3 className="m-0 font-public-sans text-[13px] font-medium text-night-fg">
              {entry.workspaceLabel}
            </h3>
            <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 font-public-sans text-[11px]">
              <dt className="text-night-fg-3">Status</dt>
              <dd className="m-0 text-night-fg-2">
                {PROGRESS_LABELS[entry.status.progress]} · {entry.status.state.replaceAll('_', ' ')}
              </dd>
              <dt className="text-night-fg-3">Requested</dt>
              <dd className="m-0 text-night-fg-2">{formatDate(entry.status.requested_at)}</dd>
              {entry.status.completed_at ? (
                <>
                  <dt className="text-night-fg-3">Completed</dt>
                  <dd className="m-0 text-night-fg-2">{formatDate(entry.status.completed_at)}</dd>
                  <dt className="text-night-fg-3">Available until</dt>
                  <dd className="m-0 text-night-fg-2">
                    {formatDate(entry.status.receipt_available_until)}
                  </dd>
                </>
              ) : null}
              <dt className="text-night-fg-3">Request</dt>
              <dd className="m-0 break-all font-public-mono text-[10px] text-night-fg-2">
                {requestId}
              </dd>
            </dl>
            {entry.status.retry_at ? (
              <p className="m-0 mt-2 font-public-sans text-[11px] text-night-fg-3">
                Next automatic attempt {formatDate(entry.status.retry_at)}
              </p>
            ) : null}
            {entry.status.error_code ? (
              <p className="m-0 mt-2 font-public-sans text-[12px] leading-[1.5] text-warn">
                {publicDeletionError(entry.status.error_code)}
              </p>
            ) : null}
            {entry.status.state === 'dead_letter' ? (
              <p className="m-0 mt-2 font-public-sans text-[12px] leading-[1.5] text-bad">
                Automatic deletion stopped after repeated failures. Contact support with the request
                ID; an operator must verify the root cause before an audited recovery.
              </p>
            ) : null}
            {receipt ? <DeletionReceiptDetails receipt={receipt} /> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {entry.status.can_cancel ? (
                <button
                  type="button"
                  onClick={() => void cancelRecoveredDeletion(entry)}
                  disabled={busy !== ''}
                  className="ps-btn-ghost"
                >
                  {busy === `cancel:${requestId}` ? 'Canceling…' : 'Cancel deletion'}
                </button>
              ) : null}
              {receipt ? (
                <>
                  <button
                    type="button"
                    onClick={() => void copyRecoveredReceipt(entry)}
                    disabled={busy !== ''}
                    className="ps-btn-ghost"
                  >
                    {busy === `copy:${requestId}` ? 'Copying…' : 'Copy receipt'}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadRecoveredReceipt(entry)}
                    disabled={busy !== ''}
                    className="ps-btn-ghost"
                  >
                    {busy === `download:${requestId}` ? 'Downloading…' : 'Download receipt'}
                  </button>
                  {confirmClear === requestId ? (
                    <>
                      <button
                        type="button"
                        onClick={() => clearRecoveredReceipt(entry)}
                        disabled={busy !== ''}
                        className="ps-btn-ghost !border-bad/60 !text-bad"
                      >
                        Confirm hide
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClear('')}
                        disabled={busy !== ''}
                        className="ps-btn-ghost"
                      >
                        Keep receipt
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmClear(requestId);
                        setActionError('');
                        setNotice(
                          'Hiding removes the browser pointer for this session. The protected server receipt remains authoritative until it expires.'
                        );
                      }}
                      disabled={busy !== ''}
                      className="ps-btn-ghost"
                    >
                      Hide saved receipt
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </section>
        );
      })}

      {currentView.truncated ? (
        <p className="m-0 mt-4 font-public-sans text-[11px] leading-[1.5] text-warn" role="status">
          Showing the newest 50 requester-bound deletions. Saved browser pointers are checked as a
          supplement; contact support with an older request ID if it is not listed.
        </p>
      ) : null}

      {currentView.error ? (
        <div className="mt-4" role="alert">
          <p className="m-0 font-public-sans text-[12px] leading-[1.5] text-bad">
            {currentView.error}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy !== ''}
            className="ps-btn-ghost mt-2"
          >
            Retry deletion recovery
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p className="m-0 mt-3 font-public-sans text-[12px] text-bad" role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p
          className="m-0 mt-3 font-public-sans text-[12px] text-signal"
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>
      ) : null}
    </aside>
  );
}

export function WorkspaceLifecycleSection({
  session,
  workspaceId,
  workspaceName,
  onDeleted,
}: {
  session: Session;
  workspaceId: string;
  workspaceName: string;
  onDeleted: () => Promise<void>;
}) {
  const actorId = session.user.id;
  const persisted = useRef(loadPersistedDeletion(actorId, workspaceId));
  const [requestId, setRequestId] = useState(persisted.current?.requestId ?? null);
  const [status, setStatus] = useState<WorkspaceDeletionStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [nameConfirmation, setNameConfirmation] = useState('');
  const [destructiveConfirmation, setDestructiveConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [discoveryState, setDiscoveryState] = useState<
    'pending' | 'loading' | 'complete' | 'error'
  >(persisted.current?.requestId ? 'complete' : 'pending');
  const [discoveryError, setDiscoveryError] = useState('');
  const [discoveryRevision, setDiscoveryRevision] = useState(0);
  const pollAttempts = useRef(0);
  const lastObservedStatus = useRef('');
  const statusGeneration = useRef(0);
  const discoveryGeneration = useRef(0);
  const expectedDestructiveText = `DELETE ${workspaceName}`;
  const gatesFetcher = useCallback(() => fetchPublicReleaseGates(), []);
  const {
    data: releaseGates,
    loading: releaseGatesLoading,
    error: releaseGateError,
    reload: reloadReleaseGates,
  } = usePageData(gatesFetcher);
  const newBeginsEnabled =
    !releaseGatesLoading && !releaseGateError && releaseGates?.workspace_deletion === true;

  const acceptStatus = useCallback(
    (next: WorkspaceDeletionStatus) => {
      setRequestId(next.request_id);
      setStatus(next);
      if (persisted.current?.requestId !== next.request_id) {
        const saved: PersistedDeletion = {
          requestId: next.request_id,
          beginKey: persisted.current?.beginKey ?? null,
        };
        persisted.current = saved;
        savePersistedDeletion(actorId, workspaceId, saved);
      }
    },
    [actorId, workspaceId]
  );

  useEffect(() => {
    if (requestId) {
      setDiscoveryState('complete');
      setDiscoveryError('');
      return;
    }
    const generation = ++discoveryGeneration.current;
    setDiscoveryState('loading');
    setDiscoveryError('');
    void fetchCurrentWorkspaceDeletion(workspaceId)
      .then((current) => {
        if (generation !== discoveryGeneration.current) return;
        setDiscoveryState('complete');
        if (!current) return;
        if (current.state === 'canceled') {
          clearPersistedDeletion(actorId, workspaceId);
          persisted.current = null;
          return;
        }
        acceptStatus(current);
        setNotice('Recovered the current deletion from protected server state.');
      })
      .catch((value: unknown) => {
        if (generation !== discoveryGeneration.current) return;
        setDiscoveryState('error');
        setDiscoveryError(
          value instanceof Error
            ? value.message
            : 'Current workspace deletion could not be verified.'
        );
      });
    return () => {
      discoveryGeneration.current += 1;
    };
  }, [acceptStatus, actorId, discoveryRevision, requestId, workspaceId]);

  const refreshStatus = useCallback(async () => {
    if (!requestId) return;
    const generation = ++statusGeneration.current;
    try {
      const next = await fetchWorkspaceDeletionStatus(requestId);
      if (generation !== statusGeneration.current) return;
      const fingerprint = [
        next.state,
        next.progress,
        next.retry_at ?? '',
        next.error_code ?? '',
        String(next.can_cancel),
      ].join(':');
      if (lastObservedStatus.current === fingerprint) pollAttempts.current += 1;
      else {
        lastObservedStatus.current = fingerprint;
        pollAttempts.current = 0;
      }
      acceptStatus(next);
      setError('');
      if (next.state === 'canceled') {
        clearPersistedDeletion(actorId, workspaceId);
        persisted.current = null;
        setRequestId(null);
        setStatus(null);
        setDiscoveryState('pending');
        setDiscoveryRevision((revision) => revision + 1);
        setNotice('Workspace deletion was canceled. The workspace is active again.');
        return;
      }
      if (next.state === 'completed') {
        setNotice(
          'Deletion completed and verified. Save the completion receipt before leaving this workspace.'
        );
      }
    } catch (value) {
      if (generation !== statusGeneration.current) return;
      setError(value instanceof Error ? value.message : 'Deletion status could not be loaded.');
      if (value instanceof PostshowFunctionError && value.status === 404) {
        clearPersistedDeletion(actorId, workspaceId);
        persisted.current = null;
        setRequestId(null);
        setStatus(null);
        setDiscoveryState('pending');
        setDiscoveryRevision((revision) => revision + 1);
      }
    }
  }, [acceptStatus, actorId, requestId, workspaceId]);

  useEffect(() => {
    if (!requestId) return;
    void refreshStatus();
  }, [refreshStatus, requestId]);

  useEffect(() => {
    if (
      !requestId ||
      !status ||
      ['completed', 'canceled', 'dead_letter'].includes(status.state) ||
      (status.state === 'failed' && !status.retry_at)
    )
      return;
    const backoff = Math.min(15_000, 2500 * 1.45 ** pollAttempts.current);
    const retryAt = status.retry_at ? new Date(status.retry_at).valueOf() : Number.NaN;
    const delay = Number.isFinite(retryAt)
      ? Math.min(30_000, Math.max(backoff, retryAt - Date.now()))
      : backoff;
    const timer = window.setTimeout(() => void refreshStatus(), delay);
    return () => window.clearTimeout(timer);
  }, [refreshStatus, requestId, status]);

  useEffect(() => {
    if (!requestId) return;
    const refresh = () => void refreshStatus();
    const visible = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refreshStatus, requestId]);

  async function beginDeletion(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy) return;
    if (!requestId && (discoveryState !== 'complete' || !newBeginsEnabled)) {
      setError('New workspace deletion availability could not be verified.');
      return;
    }
    if (
      !requestId &&
      (nameConfirmation !== workspaceName || destructiveConfirmation !== expectedDestructiveText)
    ) {
      setError('Both confirmation fields must match exactly.');
      return;
    }
    setBusy('delete');
    setError('');
    setNotice('Verifying your recent sign-in before starting workspace deletion…');
    let mutationAttempted = false;
    try {
      const accessToken = await destructiveAccessToken(session, password);
      setPassword('');
      const operation = persisted.current?.beginKey
        ? persisted.current
        : {
            requestId: null,
            beginKey: crypto.randomUUID(),
          };
      persisted.current = operation;
      savePersistedDeletion(actorId, workspaceId, operation);
      setNotice('Closing the workspace to new work and starting verified deletion…');
      mutationAttempted = true;
      const next = await beginWorkspaceDeletion(
        workspaceId,
        workspaceName,
        operation.beginKey!,
        accessToken
      );
      const saved = { requestId: next.request_id, beginKey: operation.beginKey };
      statusGeneration.current += 1;
      persisted.current = saved;
      savePersistedDeletion(actorId, workspaceId, saved);
      pollAttempts.current = 0;
      lastObservedStatus.current = '';
      setRequestId(next.request_id);
      setStatus(next);
      setConfirming(false);
      setNotice('Deletion accepted. You can leave this page; progress is durable.');
    } catch (value) {
      if (
        mutationAttempted &&
        (!(value instanceof PostshowFunctionError) || value.status === null)
      ) {
        try {
          const current = await fetchCurrentWorkspaceDeletion(workspaceId);
          if (current && current.state !== 'canceled') {
            statusGeneration.current += 1;
            acceptStatus(current);
            setConfirming(false);
            setError('');
            setNotice(
              'The original response was lost, but Postshow recovered the accepted deletion from protected server state.'
            );
            return;
          }
        } catch {
          // Keep the original begin error; the saved replay key remains safe to retry.
        }
      }
      setNotice('');
      setError(deletionActionError(value, 'Workspace deletion could not start.'));
    } finally {
      setBusy('');
    }
  }

  async function cancelDeletion() {
    if (!status?.can_cancel || busy) return;
    const scope = `${actorId}.${workspaceId}.delete-cancel.${status.request_id}`;
    setBusy('cancel');
    setError('');
    setNotice('Canceling before provider cleanup begins…');
    try {
      const next = await cancelWorkspaceDeletion(status.request_id, idempotencyKey(scope));
      statusGeneration.current += 1;
      setStatus(next);
      clearIdempotencyKey(scope);
      clearPersistedDeletion(actorId, workspaceId);
      persisted.current = null;
      setRequestId(null);
      setStatus(null);
      setDiscoveryState('pending');
      setDiscoveryRevision((revision) => revision + 1);
      setNameConfirmation('');
      setDestructiveConfirmation('');
      setNotice('Workspace deletion canceled. The workspace is active again.');
    } catch (value) {
      setNotice('');
      setError(value instanceof Error ? value.message : 'Deletion could not be canceled.');
    } finally {
      setBusy('');
    }
  }

  async function copyDeletionReceipt() {
    if (!status?.completion_receipt || busy) return;
    setBusy('copy-receipt');
    setError('');
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this browser.');
      }
      await navigator.clipboard.writeText(
        `${JSON.stringify(deletionReceiptDocument(status), null, 2)}\n`
      );
      setNotice('Deletion receipt copied to the clipboard.');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Deletion receipt could not be copied.');
    } finally {
      setBusy('');
    }
  }

  function downloadDeletionReceipt() {
    if (!status?.completion_receipt || busy) return;
    setError('');
    const fileName = `postshow-deletion-receipt-${status.request_id}.json`;
    try {
      triggerDownload(
        {
          blob: new Blob([`${JSON.stringify(deletionReceiptDocument(status), null, 2)}\n`], {
            type: 'application/json;charset=utf-8',
          }),
          fileName,
        },
        'Deletion receipt could not be downloaded in this browser.'
      );
      setNotice(`Deletion receipt downloaded as ${fileName}.`);
    } catch (value) {
      setError(
        value instanceof Error ? value.message : 'Deletion receipt could not be downloaded.'
      );
    }
  }

  async function leaveCompletedWorkspace() {
    if (status?.state !== 'completed' || busy) return;
    setBusy('leave-completed');
    setError('');
    try {
      await onDeleted();
      clearPersistedDeletion(actorId, workspaceId);
      persisted.current = null;
      setRequestId(null);
      setStatus(null);
    } catch (value) {
      setError(
        value instanceof Error ? value.message : 'Your workspace list could not be refreshed.'
      );
      setBusy('');
    }
  }

  const canSubmit =
    nameConfirmation === workspaceName &&
    destructiveConfirmation === expectedDestructiveText &&
    busy === '' &&
    discoveryState === 'complete' &&
    newBeginsEnabled;
  const checkingForCurrent = !requestId && !status && discoveryState !== 'complete';
  const canReviewDeletion =
    !requestId && !status && discoveryState === 'complete' && newBeginsEnabled && busy === '';
  const exportDisabled =
    busy === 'delete' || requestId !== null || (status !== null && status.state !== 'canceled');

  return (
    <Section title="Workspace data and lifecycle">
      <div className="ps-card flex flex-col gap-5 p-4 sm:p-5">
        <WorkspaceExportPanel
          key={workspaceId}
          workspaceId={workspaceId}
          disabled={exportDisabled}
        />

        <div className="border-t border-night-4 pt-5">
          <h3 className="m-0 font-public-sans text-[14px] font-medium text-bad">
            Delete workspace
          </h3>
          <p className="m-0 mt-1 max-w-[68ch] font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
            Permanently removes workspace data, encrypted connector credentials, API tokens, and
            engine keys. Billing resources are closed and verified first. Financial receipts and a
            minimal deletion tombstone are retained only where accounting and fraud controls require
            them.
          </p>

          {status ? (
            <div className="mt-4 rounded-md border border-night-4 bg-night-2 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div role="status" aria-live="polite">
                  <p className="m-0 font-public-sans text-[14px] font-medium text-night-fg">
                    {PROGRESS_LABELS[status.progress]}
                  </p>
                  <p className="m-0 mt-1 font-public-sans text-[12px] text-night-fg-2">
                    Request {status.state.replaceAll('_', ' ')} · started{' '}
                    {formatDate(status.requested_at)}
                  </p>
                  {status.retry_at ? (
                    <p className="m-0 mt-1 font-public-sans text-[12px] text-night-fg-3">
                      Next automatic attempt {formatDate(status.retry_at)}
                    </p>
                  ) : null}
                </div>
                {status.can_cancel ? (
                  <button
                    type="button"
                    onClick={() => void cancelDeletion()}
                    disabled={busy !== ''}
                    className="ps-btn-ghost shrink-0"
                  >
                    {busy === 'cancel' ? 'Canceling…' : 'Cancel deletion'}
                  </button>
                ) : null}
              </div>
              {status.error_code ? (
                <p className="m-0 mt-3 font-public-sans text-[12px] leading-[1.5] text-warn">
                  {publicDeletionError(status.error_code)}
                </p>
              ) : null}
              {status.state === 'completed' && status.completion_receipt ? (
                <div className="mt-4 rounded-md border border-signal/50 bg-night-1 p-3 sm:p-4">
                  <p className="m-0 font-public-sans text-[13px] font-medium text-night-fg">
                    Verified deletion receipt
                  </p>
                  <p className="m-0 mt-1 max-w-[68ch] font-public-sans text-[12px] leading-[1.5] text-night-fg-2">
                    This receipt proves that the recorded provider targets, workspace manifest, and
                    usage ledger were finalized together. Save a copy before access expires{' '}
                    {formatDate(status.receipt_available_until)}.
                  </p>
                  <DeletionReceiptDetails receipt={status.completion_receipt} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyDeletionReceipt()}
                      disabled={busy !== ''}
                      className="ps-btn-ghost"
                    >
                      {busy === 'copy-receipt' ? 'Copying…' : 'Copy receipt'}
                    </button>
                    <button
                      type="button"
                      onClick={downloadDeletionReceipt}
                      disabled={busy !== ''}
                      className="ps-btn-ghost"
                    >
                      Download receipt
                    </button>
                    <button
                      type="button"
                      onClick={() => void leaveCompletedWorkspace()}
                      disabled={busy !== ''}
                      className="ps-btn-primary"
                    >
                      {busy === 'leave-completed' ? 'Refreshing…' : 'Leave deleted workspace'}
                    </button>
                  </div>
                </div>
              ) : null}
              {status.state === 'dead_letter' ? (
                <p className="m-0 mt-3 font-public-sans text-[12px] leading-[1.5] text-bad">
                  Automatic deletion stopped after repeated failures. Contact support with the
                  request ID; an operator must verify the root cause before an audited recovery.
                </p>
              ) : null}
            </div>
          ) : confirming ? (
            <form
              onSubmit={(event) => void beginDeletion(event)}
              className="mt-4 rounded-md border border-bad/60 bg-night-2 p-4"
            >
              <p className="m-0 font-public-sans text-[13px] font-medium text-night-fg">
                This cannot be undone after provider cleanup begins.
              </p>
              <div className="mt-4 grid gap-3">
                <label className="flex flex-col gap-1">
                  <span className="ps-label">Type the workspace name exactly</span>
                  <input
                    value={nameConfirmation}
                    onChange={(event) => setNameConfirmation(event.target.value)}
                    className="ps-input"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="ps-label">
                    Type{' '}
                    <span className="normal-case text-night-fg">{expectedDestructiveText}</span>
                  </span>
                  <input
                    value={destructiveConfirmation}
                    onChange={(event) => setDestructiveConfirmation(event.target.value)}
                    className="ps-input"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <FreshAuthPasswordField value={password} onChange={setPassword} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="ps-btn-primary !bg-bad !text-white hover:!bg-bad"
                >
                  {busy === 'delete' ? 'Starting…' : 'Permanently delete workspace'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setNameConfirmation('');
                    setDestructiveConfirmation('');
                    setPassword('');
                    setError('');
                  }}
                  disabled={busy !== ''}
                  className="ps-btn-ghost"
                >
                  Keep workspace
                </button>
              </div>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  if (!canReviewDeletion) return;
                  setConfirming(true);
                  setNotice('Download an export first if you need a copy of this workspace.');
                }}
                disabled={!canReviewDeletion}
                className="ps-btn-ghost mt-4 !border-bad/60 !text-bad"
              >
                {checkingForCurrent
                  ? discoveryState === 'error'
                    ? 'Deletion recovery unavailable'
                    : 'Checking for current deletion…'
                  : releaseGatesLoading
                    ? 'Checking deletion availability…'
                    : releaseGateError
                      ? 'Deletion availability unavailable'
                      : releaseGates?.workspace_deletion === false
                        ? 'New deletions paused'
                        : persisted.current?.beginKey
                          ? 'Resume deletion request'
                          : 'Review workspace deletion'}
              </button>

              {discoveryError ? (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <ErrorRow message={discoveryError} />
                  <button
                    type="button"
                    onClick={() => {
                      setDiscoveryState('pending');
                      setDiscoveryRevision((revision) => revision + 1);
                    }}
                    disabled={discoveryState === 'loading'}
                    className="ps-btn-ghost"
                  >
                    Retry deletion recovery
                  </button>
                </div>
              ) : null}

              {discoveryState === 'complete' && releaseGateError ? (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <ErrorRow message="New deletion availability could not be verified. Existing deletion recovery remains available." />
                  <button type="button" onClick={reloadReleaseGates} className="ps-btn-ghost">
                    Retry availability check
                  </button>
                </div>
              ) : null}

              {discoveryState === 'complete' &&
              !releaseGateError &&
              releaseGates?.workspace_deletion === false ? (
                <p
                  className="m-0 mt-3 font-public-sans text-[12px] leading-[1.5] text-night-fg-3"
                  role="status"
                >
                  New workspace deletions are temporarily paused. Status, cancellation, automatic
                  recovery, and receipt access for an existing deletion remain available.
                </p>
              ) : null}
            </>
          )}
        </div>

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
    </Section>
  );
}
