import { invokePostshowFunction } from './functionClient';

export const WORKSPACE_EXPORT_CONTENT_TYPE = 'application/x-ndjson';
export const WORKSPACE_EXPORT_FORMAT = 'postshow-workspace-ndjson';
export const WORKSPACE_EXPORT_CHECKSUM_ALGORITHM = 'sha256-part-tree-v1';

export type WorkspaceExportState =
  | 'queued'
  | 'snapshotting'
  | 'uploading'
  | 'finalizing'
  | 'ready'
  | 'canceling'
  | 'canceled'
  | 'failing'
  | 'failed'
  | 'expiring'
  | 'expired';

export interface WorkspaceExportIntegrityPart {
  part_number: number;
  byte_size: number;
  sha256: string;
}

export interface WorkspaceExportStatus {
  request_id: string;
  workspace_id: string;
  state: WorkspaceExportState;
  schema_version: 3;
  format: typeof WORKSPACE_EXPORT_FORMAT;
  snapshot_at: string | null;
  record_count: number;
  artifact_bytes: number;
  content_type: typeof WORKSPACE_EXPORT_CONTENT_TYPE;
  filename: string;
  part_count: number;
  uploaded_parts: number;
  checksum_algorithm: typeof WORKSPACE_EXPORT_CHECKSUM_ALGORITHM;
  artifact_checksum: string | null;
  integrity_parts: WorkspaceExportIntegrityPart[];
  requested_at: string;
  ready_at: string | null;
  expires_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  expired_at: string | null;
  error_code: string | null;
}

export interface WorkspaceExportDownload {
  url: string;
  expires_at: string;
  filename: string;
  content_type: typeof WORKSPACE_EXPORT_CONTENT_TYPE;
  artifact_bytes: number;
  checksum_algorithm: typeof WORKSPACE_EXPORT_CHECKSUM_ALGORITHM;
  artifact_checksum: string;
  integrity_parts: WorkspaceExportIntegrityPart[];
}

export interface WorkspaceExportIntegrityManifest {
  manifest_type: 'postshow_workspace_export_integrity';
  manifest_version: 1;
  export_schema_version: 3;
  request_id: string;
  workspace_id: string;
  format: typeof WORKSPACE_EXPORT_FORMAT;
  filename: string;
  snapshot_at: string;
  record_count: number;
  content_type: typeof WORKSPACE_EXPORT_CONTENT_TYPE;
  artifact_bytes: number;
  checksum_algorithm: typeof WORKSPACE_EXPORT_CHECKSUM_ALGORITHM;
  artifact_checksum: string;
  parts: WorkspaceExportIntegrityPart[];
}

const EXPORT_FUNCTION =
  import.meta.env.VITE_POSTSHOW_WORKSPACE_EXPORT_FUNCTION?.trim() || 'postshow-workspace-export';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ERROR_CODE_RE = /^[a-z0-9_.-]{1,80}$/;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_RECORDS = 100_000_000;
const MAX_PARTS = 10_000;
const MAX_PART_BYTES = 72 * 1024 * 1024;
const MAX_SIGNED_URL_MS = 60 * 1000;
const DOWNLOAD_CLOCK_SKEW_MS = 10_000;
const EXPORT_ACCESS_RETENTION_MS = 24 * 60 * 60 * 1000;
const EXPORT_RETENTION_TOLERANCE_MS = 1_000;
const STATUS_KEYS = [
  'request_id',
  'workspace_id',
  'state',
  'schema_version',
  'format',
  'snapshot_at',
  'record_count',
  'artifact_bytes',
  'content_type',
  'filename',
  'part_count',
  'uploaded_parts',
  'checksum_algorithm',
  'artifact_checksum',
  'integrity_parts',
  'requested_at',
  'ready_at',
  'expires_at',
  'canceled_at',
  'failed_at',
  'expired_at',
  'error_code',
] as const;
const STATES: readonly WorkspaceExportState[] = [
  'queued',
  'snapshotting',
  'uploading',
  'finalizing',
  'ready',
  'canceling',
  'canceled',
  'failing',
  'failed',
  'expiring',
  'expired',
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Workspace export service returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Workspace export service returned an unexpected ${label} shape.`);
  }
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error(`Workspace export service returned an invalid ${label}.`);
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Workspace export service returned an invalid ${label}.`);
  }
  return value as number;
}

function requiredString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`Workspace export service returned an invalid ${label}.`);
  }
  return value;
}

function dateString(value: unknown, label: string): string {
  const result = requiredString(value, 100, label);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`Workspace export service returned an invalid ${label}.`);
  }
  return result;
}

function optionalDate(value: unknown, label: string): string | null {
  return value === null ? null : dateString(value, label);
}

function checksum(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new Error(`Workspace export service returned an invalid ${label}.`);
  }
  return value;
}

function optionalChecksum(value: unknown, label: string): string | null {
  return value === null ? null : checksum(value, label);
}

function parseIntegrityParts(value: unknown): WorkspaceExportIntegrityPart[] {
  if (!Array.isArray(value) || value.length > MAX_PARTS) {
    throw new Error('Workspace export service returned an invalid integrity manifest.');
  }
  return value.map((entry, index) => {
    const part = record(entry, 'integrity part');
    exactKeys(part, ['part_number', 'byte_size', 'sha256'], 'integrity part');
    const partNumber = integer(part.part_number, 1, MAX_PARTS, 'part number');
    if (partNumber !== index + 1) {
      throw new Error('Workspace export service returned non-contiguous integrity parts.');
    }
    return {
      part_number: partNumber,
      byte_size: integer(part.byte_size, 1, MAX_PART_BYTES, 'part size'),
      sha256: checksum(part.sha256, 'part checksum'),
    };
  });
}

function parseStatus(value: unknown): WorkspaceExportStatus {
  const row = record(value, 'status');
  exactKeys(row, STATUS_KEYS, 'status');
  if (typeof row.state !== 'string' || !STATES.includes(row.state as WorkspaceExportState)) {
    throw new Error('Workspace export service returned an invalid state.');
  }
  const requestId = uuid(row.request_id, 'request ID');
  const workspaceId = uuid(row.workspace_id, 'workspace ID');
  const filename = requiredString(row.filename, 300, 'filename');
  if (filename !== `postshow-workspace-${workspaceId}-${requestId}.ndjson`) {
    throw new Error('Workspace export service returned an inconsistent filename.');
  }
  const state = row.state as WorkspaceExportState;
  const partCount = integer(row.part_count, 0, MAX_PARTS, 'part count');
  const uploadedParts = integer(row.uploaded_parts, 0, MAX_PARTS, 'uploaded part count');
  if (uploadedParts > partCount) {
    throw new Error('Workspace export service returned inconsistent upload progress.');
  }
  const artifactBytes = integer(row.artifact_bytes, 0, MAX_ARTIFACT_BYTES, 'artifact size');
  const recordCount = integer(row.record_count, 0, MAX_RECORDS, 'record count');
  const integrityParts = parseIntegrityParts(row.integrity_parts);
  const artifactChecksum = optionalChecksum(row.artifact_checksum, 'artifact checksum');
  const requestedAt = dateString(row.requested_at, 'request date');
  const snapshotAt = optionalDate(row.snapshot_at, 'snapshot date');
  const readyAt = optionalDate(row.ready_at, 'ready date');
  const expiresAt = optionalDate(row.expires_at, 'expiration date');
  const canceledAt = optionalDate(row.canceled_at, 'cancellation date');
  const failedAt = optionalDate(row.failed_at, 'failure date');
  const expiredAt = optionalDate(row.expired_at, 'expiry date');
  const rawErrorCode = row.error_code;
  const errorCode =
    rawErrorCode === '' || rawErrorCode === null
      ? null
      : requiredString(rawErrorCode, 80, 'error code');
  if (errorCode !== null && !ERROR_CODE_RE.test(errorCode)) {
    throw new Error('Workspace export service returned an invalid error code.');
  }
  if (
    row.schema_version !== 3 ||
    row.format !== WORKSPACE_EXPORT_FORMAT ||
    row.content_type !== WORKSPACE_EXPORT_CONTENT_TYPE ||
    row.checksum_algorithm !== WORKSPACE_EXPORT_CHECKSUM_ALGORITHM
  ) {
    throw new Error('Workspace export service returned an unsupported export contract.');
  }
  if (state === 'ready') {
    if (
      snapshotAt === null ||
      readyAt === null ||
      expiresAt === null ||
      artifactChecksum === null ||
      artifactBytes < 1 ||
      recordCount < 1 ||
      partCount < 1 ||
      uploadedParts !== partCount ||
      integrityParts.length !== partCount ||
      integrityParts.reduce((sum, part) => sum + part.byte_size, 0) !== artifactBytes ||
      Date.parse(readyAt) < Date.parse(requestedAt) ||
      Date.parse(snapshotAt) > Date.parse(readyAt) ||
      Math.abs(Date.parse(expiresAt) - Date.parse(readyAt) - EXPORT_ACCESS_RETENTION_MS) >
        EXPORT_RETENTION_TOLERANCE_MS
    ) {
      throw new Error('Workspace export service returned an inconsistent ready export.');
    }
  } else if (integrityParts.length !== 0) {
    throw new Error(
      'Workspace export service exposed integrity parts before the export was ready.'
    );
  }
  if (
    (state === 'canceled') !== (canceledAt !== null) ||
    (state === 'failed') !== (failedAt !== null) ||
    (state === 'expired') !== (expiredAt !== null)
  ) {
    throw new Error('Workspace export service returned inconsistent terminal state metadata.');
  }

  return {
    request_id: requestId,
    workspace_id: workspaceId,
    state,
    schema_version: 3,
    format: WORKSPACE_EXPORT_FORMAT,
    snapshot_at: snapshotAt,
    record_count: recordCount,
    artifact_bytes: artifactBytes,
    content_type: WORKSPACE_EXPORT_CONTENT_TYPE,
    filename,
    part_count: partCount,
    uploaded_parts: uploadedParts,
    checksum_algorithm: WORKSPACE_EXPORT_CHECKSUM_ALGORITHM,
    artifact_checksum: artifactChecksum,
    integrity_parts: integrityParts,
    requested_at: requestedAt,
    ready_at: readyAt,
    expires_at: expiresAt,
    canceled_at: canceledAt,
    failed_at: failedAt,
    expired_at: expiredAt,
    error_code: errorCode,
  };
}

function parseStatusResponse(value: unknown): WorkspaceExportStatus {
  const payload = record(value, 'response');
  exactKeys(payload, ['ok', 'request'], 'response');
  if (payload.ok !== true) {
    throw new Error('Workspace export service did not confirm the request.');
  }
  return parseStatus(payload.request);
}

function parseCurrentStatusResponse(value: unknown): WorkspaceExportStatus | null {
  const payload = record(value, 'current response');
  exactKeys(payload, ['ok', 'request'], 'current response');
  if (payload.ok !== true) {
    throw new Error('Workspace export service did not confirm current export discovery.');
  }
  return payload.request === null ? null : parseStatus(payload.request);
}

function configuredSupabaseUrl(): URL {
  const raw = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Workspace export download origin is not configured.');
  }
  return url;
}

function validatedDownloadUrl(value: unknown, status: WorkspaceExportStatus): string {
  const raw = requiredString(value, 10_000, 'download URL');
  const configured = configuredSupabaseUrl();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Workspace export service returned an invalid download URL.');
  }
  const local = ['localhost', '127.0.0.1'].includes(configured.hostname);
  const expectedPath =
    `/storage/v1/object/sign/postshow-workspace-exports/${status.workspace_id}/` +
    `${status.request_id}/workspace.ndjson`;
  const queryKeys = [...url.searchParams.keys()].sort();
  if (
    url.origin !== configured.origin ||
    (!local && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.pathname !== expectedPath ||
    queryKeys.length !== 2 ||
    queryKeys[0] !== 'download' ||
    queryKeys[1] !== 'token' ||
    url.searchParams.getAll('token').length !== 1 ||
    !url.searchParams.get('token')?.length ||
    url.searchParams.getAll('download').length !== 1 ||
    url.searchParams.get('download') !== status.filename
  ) {
    throw new Error('Workspace export service returned an untrusted download URL.');
  }
  return url.toString();
}

function sameParts(
  left: readonly WorkspaceExportIntegrityPart[],
  right: readonly WorkspaceExportIntegrityPart[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (part, index) =>
        part.part_number === right[index]?.part_number &&
        part.byte_size === right[index]?.byte_size &&
        part.sha256 === right[index]?.sha256
    )
  );
}

export async function beginWorkspaceExport(
  workspaceId: string,
  idempotencyKey: string
): Promise<WorkspaceExportStatus> {
  const status = parseStatusResponse(
    await invokePostshowFunction(EXPORT_FUNCTION, {
      op: 'begin',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
    })
  );
  if (status.workspace_id !== workspaceId) {
    throw new Error('Workspace export service returned a different workspace.');
  }
  return status;
}

export async function fetchWorkspaceExportStatus(
  requestId: string
): Promise<WorkspaceExportStatus> {
  const status = parseStatusResponse(
    await invokePostshowFunction(EXPORT_FUNCTION, {
      op: 'status',
      request_id: requestId,
    })
  );
  if (status.request_id !== requestId) {
    throw new Error('Workspace export service returned a different request.');
  }
  return status;
}

export async function fetchCurrentWorkspaceExport(
  workspaceId: string
): Promise<WorkspaceExportStatus | null> {
  const status = parseCurrentStatusResponse(
    await invokePostshowFunction(EXPORT_FUNCTION, {
      op: 'current',
      workspace_id: workspaceId,
    })
  );
  if (status !== null && status.workspace_id !== workspaceId) {
    throw new Error('Workspace export service returned a different workspace.');
  }
  return status;
}

export async function cancelWorkspaceExport(
  requestId: string,
  idempotencyKey: string
): Promise<WorkspaceExportStatus> {
  const status = parseStatusResponse(
    await invokePostshowFunction(EXPORT_FUNCTION, {
      op: 'cancel',
      request_id: requestId,
      idempotency_key: idempotencyKey,
    })
  );
  if (status.request_id !== requestId) {
    throw new Error('Workspace export service returned a different cancellation request.');
  }
  return status;
}

export async function createWorkspaceExportDownload(
  status: WorkspaceExportStatus
): Promise<WorkspaceExportDownload> {
  const validatedStatus = parseStatus(status);
  if (
    validatedStatus.state !== 'ready' ||
    validatedStatus.artifact_checksum === null ||
    validatedStatus.expires_at === null
  ) {
    throw new Error('Workspace export is not ready to download.');
  }
  const payload = record(
    await invokePostshowFunction(EXPORT_FUNCTION, {
      op: 'download',
      request_id: validatedStatus.request_id,
    }),
    'download response'
  );
  exactKeys(payload, ['ok', 'download'], 'download response');
  if (payload.ok !== true) {
    throw new Error('Workspace export service did not authorize the download.');
  }
  const row = record(payload.download, 'download');
  exactKeys(
    row,
    [
      'url',
      'expires_at',
      'filename',
      'content_type',
      'artifact_bytes',
      'checksum_algorithm',
      'artifact_checksum',
      'integrity_parts',
    ],
    'download'
  );
  const expiresAt = dateString(row.expires_at, 'signed URL expiration');
  const expiresMs = Date.parse(expiresAt);
  const parts = parseIntegrityParts(row.integrity_parts);
  const artifactChecksum = checksum(row.artifact_checksum, 'download checksum');
  if (
    row.filename !== validatedStatus.filename ||
    row.content_type !== validatedStatus.content_type ||
    row.checksum_algorithm !== validatedStatus.checksum_algorithm ||
    row.artifact_bytes !== validatedStatus.artifact_bytes ||
    artifactChecksum !== validatedStatus.artifact_checksum ||
    !sameParts(parts, validatedStatus.integrity_parts) ||
    expiresMs <= Date.now() - DOWNLOAD_CLOCK_SKEW_MS ||
    expiresMs > Date.now() + MAX_SIGNED_URL_MS + DOWNLOAD_CLOCK_SKEW_MS ||
    expiresMs > Date.parse(validatedStatus.expires_at) + DOWNLOAD_CLOCK_SKEW_MS
  ) {
    throw new Error('Workspace export service returned inconsistent download metadata.');
  }
  return {
    url: validatedDownloadUrl(row.url, validatedStatus),
    expires_at: expiresAt,
    filename: validatedStatus.filename,
    content_type: WORKSPACE_EXPORT_CONTENT_TYPE,
    artifact_bytes: validatedStatus.artifact_bytes,
    checksum_algorithm: WORKSPACE_EXPORT_CHECKSUM_ALGORITHM,
    artifact_checksum: artifactChecksum,
    integrity_parts: parts,
  };
}

export function workspaceExportIntegrityManifest(
  status: WorkspaceExportStatus
): WorkspaceExportIntegrityManifest {
  const validatedStatus = parseStatus(status);
  if (
    validatedStatus.state !== 'ready' ||
    validatedStatus.snapshot_at === null ||
    validatedStatus.artifact_checksum === null
  ) {
    throw new Error('Workspace export integrity metadata is not ready.');
  }
  return {
    manifest_type: 'postshow_workspace_export_integrity',
    manifest_version: 1,
    export_schema_version: 3,
    request_id: validatedStatus.request_id,
    workspace_id: validatedStatus.workspace_id,
    format: validatedStatus.format,
    filename: validatedStatus.filename,
    snapshot_at: validatedStatus.snapshot_at,
    record_count: validatedStatus.record_count,
    content_type: validatedStatus.content_type,
    artifact_bytes: validatedStatus.artifact_bytes,
    checksum_algorithm: validatedStatus.checksum_algorithm,
    artifact_checksum: validatedStatus.artifact_checksum,
    parts: validatedStatus.integrity_parts,
  };
}

export function workspaceExportAccessDeadline(status: WorkspaceExportStatus): number {
  if (status.state !== 'ready' || status.ready_at === null || status.expires_at === null) {
    return Number.NaN;
  }
  return Math.min(
    Date.parse(status.expires_at),
    Date.parse(status.ready_at) + EXPORT_ACCESS_RETENTION_MS
  );
}
