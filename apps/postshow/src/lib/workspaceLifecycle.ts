import { invokePostshowFunction } from './functionClient';

export type WorkspaceDeletionState =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'uncertain'
  | 'dead_letter'
  | 'canceled';

export type WorkspaceDeletionProgress =
  | 'queued'
  | 'waiting_for_quiescence'
  | 'provider_cleanup'
  | 'checkout_closed'
  | 'schedule_released'
  | 'subscription_canceled'
  | 'invoice_items_cleared'
  | 'metronome_ended'
  | 'finalizing'
  | 'completed';

export interface WorkspaceDeletionReceipt {
  version: 1;
  completed_generation: number;
  target_count: number;
  provider_target_hash: string;
  target_manifest_hash: string;
  usage_ledger_hash: string;
  outcome_hash: string;
}

export interface WorkspaceDeletionStatus {
  request_id: string;
  state: WorkspaceDeletionState;
  progress: WorkspaceDeletionProgress;
  requested_at: string;
  completed_at: string | null;
  canceled_at: string | null;
  receipt_available_until: string | null;
  completion_receipt: WorkspaceDeletionReceipt | null;
  retry_at: string | null;
  error_code: string | null;
  can_cancel: boolean;
}

export interface RequesterWorkspaceDeletion {
  workspace_id: string;
  workspace_label: string;
  request: WorkspaceDeletionStatus;
}

export interface RequesterWorkspaceDeletions {
  requests: RequesterWorkspaceDeletion[];
  truncated: boolean;
}

const DELETION_FUNCTION =
  import.meta.env.VITE_POSTSHOW_WORKSPACE_DELETION_FUNCTION?.trim() ||
  'postshow-workspace-deletion';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELETION_STATES: readonly WorkspaceDeletionState[] = [
  'pending',
  'claimed',
  'completed',
  'failed',
  'uncertain',
  'dead_letter',
  'canceled',
];
const DELETION_PROGRESS: readonly WorkspaceDeletionProgress[] = [
  'queued',
  'waiting_for_quiescence',
  'provider_cleanup',
  'checkout_closed',
  'schedule_released',
  'subscription_canceled',
  'invoice_items_cleared',
  'metronome_ended',
  'finalizing',
  'completed',
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Workspace service returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Workspace service returned an invalid ${label}.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requiredString(value, label);
}

function dateString(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!Number.isFinite(new Date(result).valueOf())) {
    throw new Error(`Workspace service returned an invalid ${label}.`);
  }
  return result;
}

function optionalDateString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return dateString(value, label);
}

function safeInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Workspace service returned an invalid ${label}.`);
  }
  return value as number;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`Workspace service returned an invalid ${label}.`);
  }
  return value;
}

function parseDeletionReceipt(value: unknown): WorkspaceDeletionReceipt | null {
  if (value === null) return null;
  const receipt = record(value, 'deletion receipt');
  if (receipt.version !== 1) {
    throw new Error('Workspace service returned an unsupported deletion receipt.');
  }
  return {
    version: 1,
    completed_generation: safeInteger(receipt.completed_generation, 'receipt generation', 1),
    target_count: safeInteger(receipt.target_count, 'receipt target count', 0),
    provider_target_hash: sha256(receipt.provider_target_hash, 'provider target hash'),
    target_manifest_hash: sha256(receipt.target_manifest_hash, 'target manifest hash'),
    usage_ledger_hash: sha256(receipt.usage_ledger_hash, 'usage ledger hash'),
    outcome_hash: sha256(receipt.outcome_hash, 'outcome hash'),
  };
}

function enumValue<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) {
    throw new Error(`Workspace service returned an invalid ${label}.`);
  }
  return value as T;
}

function parseDeletionStatus(value: unknown): WorkspaceDeletionStatus {
  const row = record(value, 'deletion status');
  if (typeof row.can_cancel !== 'boolean') {
    throw new Error('Workspace service returned an invalid cancellation status.');
  }
  const status: WorkspaceDeletionStatus = {
    request_id: requiredString(row.request_id, 'deletion request'),
    state: enumValue(row.state, DELETION_STATES, 'deletion state'),
    progress: enumValue(row.progress, DELETION_PROGRESS, 'deletion progress'),
    requested_at: dateString(row.requested_at, 'request date'),
    completed_at: optionalDateString(row.completed_at, 'completion date'),
    canceled_at: optionalDateString(row.canceled_at, 'cancellation date'),
    receipt_available_until: optionalDateString(
      row.receipt_available_until,
      'receipt expiration date'
    ),
    completion_receipt: parseDeletionReceipt(row.completion_receipt),
    retry_at: optionalDateString(row.retry_at, 'retry date'),
    error_code: optionalString(row.error_code, 'error code'),
    can_cancel: row.can_cancel,
  };
  if (
    !UUID_RE.test(status.request_id) ||
    (status.error_code !== null && !/^[a-z0-9_.-]{1,80}$/.test(status.error_code)) ||
    (status.state === 'completed' &&
      (status.progress !== 'completed' ||
        status.completed_at === null ||
        status.receipt_available_until === null ||
        status.completion_receipt === null)) ||
    (status.state !== 'completed' && status.completion_receipt !== null) ||
    (['completed', 'canceled', 'claimed'].includes(status.state) && status.can_cancel)
  ) {
    throw new Error('Workspace service returned an inconsistent deletion status.');
  }
  return status;
}

function parseDeletionResponse(value: unknown): WorkspaceDeletionStatus {
  const payload = record(value, 'deletion response');
  const keys = Object.keys(payload).sort();
  if (keys.length !== 2 || keys[0] !== 'ok' || keys[1] !== 'request' || payload.ok !== true) {
    throw new Error('Workspace service returned an invalid deletion response.');
  }
  return parseDeletionStatus(payload.request);
}

function parseRequesterDeletionsResponse(value: unknown): RequesterWorkspaceDeletions {
  const payload = record(value, 'deletion response');
  const keys = Object.keys(payload).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'ok' ||
    keys[1] !== 'requests' ||
    keys[2] !== 'truncated' ||
    payload.ok !== true ||
    !Array.isArray(payload.requests) ||
    payload.requests.length > 50 ||
    typeof payload.truncated !== 'boolean'
  ) {
    throw new Error('Workspace service returned an invalid deletion response.');
  }
  const requests: RequesterWorkspaceDeletion[] = [];
  const seen = new Set<string>();
  let previousRequestedAt = Number.POSITIVE_INFINITY;
  for (const value of payload.requests) {
    const entry = record(value, 'deletion recovery entry');
    const entryKeys = Object.keys(entry).sort();
    if (
      entryKeys.length !== 3 ||
      entryKeys[0] !== 'request' ||
      entryKeys[1] !== 'workspace_id' ||
      entryKeys[2] !== 'workspace_label' ||
      typeof entry.workspace_id !== 'string' ||
      !UUID_RE.test(entry.workspace_id) ||
      typeof entry.workspace_label !== 'string' ||
      entry.workspace_label.length < 1 ||
      entry.workspace_label.length > 160 ||
      entry.workspace_label.trim() !== entry.workspace_label ||
      [...entry.workspace_label].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
    ) {
      throw new Error('Workspace service returned an invalid deletion recovery entry.');
    }
    const request = parseDeletionStatus(entry.request);
    const requestedAt = Date.parse(request.requested_at);
    if (seen.has(request.request_id) || requestedAt > previousRequestedAt) {
      throw new Error('Workspace service returned inconsistent deletion recovery entries.');
    }
    seen.add(request.request_id);
    previousRequestedAt = requestedAt;
    requests.push({
      workspace_id: entry.workspace_id,
      workspace_label: entry.workspace_label,
      request,
    });
  }
  return { requests, truncated: payload.truncated };
}

export async function beginWorkspaceDeletion(
  workspaceId: string,
  expectedName: string,
  idempotencyKey: string,
  accessToken: string
): Promise<WorkspaceDeletionStatus> {
  return parseDeletionResponse(
    await invokePostshowFunction(
      DELETION_FUNCTION,
      {
        op: 'begin',
        workspace_id: workspaceId,
        expected_name: expectedName,
        idempotency_key: idempotencyKey,
      },
      { accessToken }
    )
  );
}

export async function fetchWorkspaceDeletionStatus(
  requestId: string
): Promise<WorkspaceDeletionStatus> {
  const status = parseDeletionResponse(
    await invokePostshowFunction(DELETION_FUNCTION, {
      op: 'status',
      request_id: requestId,
    })
  );
  if (status.request_id !== requestId) {
    throw new Error('Workspace service returned a different deletion request.');
  }
  return status;
}

export async function fetchCurrentWorkspaceDeletion(
  workspaceId: string
): Promise<WorkspaceDeletionStatus | null> {
  const current = await fetchRequesterWorkspaceDeletions();
  return current.requests.find((entry) => entry.workspace_id === workspaceId)?.request ?? null;
}

export async function fetchRequesterWorkspaceDeletions(): Promise<RequesterWorkspaceDeletions> {
  return parseRequesterDeletionsResponse(
    await invokePostshowFunction(DELETION_FUNCTION, {
      op: 'current',
    })
  );
}

export async function cancelWorkspaceDeletion(
  requestId: string,
  idempotencyKey: string
): Promise<WorkspaceDeletionStatus> {
  const status = parseDeletionResponse(
    await invokePostshowFunction(DELETION_FUNCTION, {
      op: 'cancel',
      request_id: requestId,
      idempotency_key: idempotencyKey,
    })
  );
  if (status.request_id !== requestId) {
    throw new Error('Workspace service returned a different deletion request.');
  }
  return status;
}
