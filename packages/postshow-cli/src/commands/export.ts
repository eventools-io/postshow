import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_PART_BYTES = 72 * 1024 * 1024;
const MAX_PARTS = 10_000;

interface IntegrityPart {
  part_number: number;
  byte_size: number;
  sha256: string;
}

interface IntegrityManifest {
  manifest_type: 'postshow_workspace_export_integrity';
  manifest_version: 1;
  export_schema_version: 3;
  request_id: string;
  workspace_id: string;
  format: 'postshow-workspace-ndjson';
  filename: string;
  snapshot_at: string;
  record_count: number;
  content_type: 'application/x-ndjson';
  artifact_bytes: number;
  checksum_algorithm: 'sha256-part-tree-v1';
  artifact_checksum: string;
  parts: IntegrityPart[];
}

const MANIFEST_KEYS = [
  'manifest_type',
  'manifest_version',
  'export_schema_version',
  'request_id',
  'workspace_id',
  'format',
  'filename',
  'snapshot_at',
  'record_count',
  'content_type',
  'artifact_bytes',
  'checksum_algorithm',
  'artifact_checksum',
  'parts',
] as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid workspace export ${label}`);
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
    throw new Error(`unexpected workspace export ${label} shape`);
  }
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`invalid workspace export ${label}`);
  }
  return value as number;
}

function parseManifest(value: unknown): IntegrityManifest {
  const row = object(value, 'integrity manifest');
  exactKeys(row, MANIFEST_KEYS, 'integrity manifest');
  if (
    row.manifest_type !== 'postshow_workspace_export_integrity' ||
    row.manifest_version !== 1 ||
    row.export_schema_version !== 3 ||
    row.format !== 'postshow-workspace-ndjson' ||
    row.content_type !== 'application/x-ndjson' ||
    row.checksum_algorithm !== 'sha256-part-tree-v1' ||
    typeof row.request_id !== 'string' ||
    !UUID_RE.test(row.request_id) ||
    typeof row.workspace_id !== 'string' ||
    !UUID_RE.test(row.workspace_id) ||
    typeof row.filename !== 'string' ||
    row.filename !== `postshow-workspace-${row.workspace_id}-${row.request_id}.ndjson` ||
    typeof row.snapshot_at !== 'string' ||
    !Number.isFinite(Date.parse(row.snapshot_at)) ||
    new Date(Date.parse(row.snapshot_at)).toISOString() !== row.snapshot_at ||
    typeof row.artifact_checksum !== 'string' ||
    !SHA256_RE.test(row.artifact_checksum) ||
    !Array.isArray(row.parts) ||
    row.parts.length < 1 ||
    row.parts.length > MAX_PARTS
  ) {
    throw new Error('invalid workspace export integrity manifest');
  }
  const artifactBytes = integer(row.artifact_bytes, 1, MAX_ARTIFACT_BYTES, 'artifact size');
  const recordCount = integer(row.record_count, 1, 100_000_000, 'record count');
  const parts = row.parts.map((value, index) => {
    const part = object(value, 'integrity part');
    exactKeys(part, ['part_number', 'byte_size', 'sha256'], 'integrity part');
    const partNumber = integer(part.part_number, 1, MAX_PARTS, 'part number');
    if (
      partNumber !== index + 1 ||
      typeof part.sha256 !== 'string' ||
      !SHA256_RE.test(part.sha256)
    ) {
      throw new Error('invalid workspace export integrity part');
    }
    return {
      part_number: partNumber,
      byte_size: integer(part.byte_size, 1, MAX_PART_BYTES, 'part size'),
      sha256: part.sha256,
    };
  });
  if (parts.reduce((total, part) => total + part.byte_size, 0) !== artifactBytes) {
    throw new Error('workspace export part sizes do not match the artifact size');
  }
  return {
    manifest_type: 'postshow_workspace_export_integrity',
    manifest_version: 1,
    export_schema_version: 3,
    request_id: row.request_id,
    workspace_id: row.workspace_id,
    format: 'postshow-workspace-ndjson',
    filename: row.filename,
    snapshot_at: row.snapshot_at,
    record_count: recordCount,
    content_type: 'application/x-ndjson',
    artifact_bytes: artifactBytes,
    checksum_algorithm: 'sha256-part-tree-v1',
    artifact_checksum: row.artifact_checksum,
    parts,
  };
}

async function loadManifest(path: string): Promise<IntegrityManifest> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_MANIFEST_BYTES) {
    throw new Error('invalid workspace export integrity manifest file');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('invalid workspace export integrity manifest JSON');
  }
  return parseManifest(value);
}

export async function verifyWorkspaceExport(
  artifactPath: string,
  manifestPath: string
): Promise<IntegrityManifest> {
  const manifest = await loadManifest(manifestPath);
  if (basename(artifactPath) !== manifest.filename) {
    throw new Error('workspace export filename does not match the integrity manifest');
  }

  const handle = await open(artifactPath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== manifest.artifact_bytes) {
      throw new Error('workspace export byte size does not match the integrity manifest');
    }

    let partIndex = 0;
    let remaining = manifest.parts[0]!.byte_size;
    let partHash = createHash('sha256');
    const computedParts: IntegrityPart[] = [];
    let totalBytes = 0;
    const stream = handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 });
    for await (const value of stream) {
      const chunk = value as Buffer;
      let offset = 0;
      while (offset < chunk.byteLength) {
        const part = manifest.parts[partIndex];
        if (!part) throw new Error('workspace export contains bytes beyond its integrity manifest');
        const count = Math.min(remaining, chunk.byteLength - offset);
        partHash.update(chunk.subarray(offset, offset + count));
        offset += count;
        totalBytes += count;
        remaining -= count;
        if (remaining === 0) {
          const sha256 = partHash.digest('hex');
          if (sha256 !== part.sha256) {
            throw new Error(`workspace export integrity check failed for part ${part.part_number}`);
          }
          computedParts.push({ ...part, sha256 });
          partIndex += 1;
          if (partIndex < manifest.parts.length) {
            remaining = manifest.parts[partIndex]!.byte_size;
            partHash = createHash('sha256');
          }
        }
      }
    }

    const after = await handle.stat();
    if (
      totalBytes !== manifest.artifact_bytes ||
      partIndex !== manifest.parts.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error('workspace export changed or ended before verification completed');
    }
    const treeInput = computedParts
      .map((part) => `${part.part_number}:${part.byte_size}:${part.sha256}`)
      .join('\n');
    const treeChecksum = createHash('sha256').update(treeInput, 'utf8').digest('hex');
    if (treeChecksum !== manifest.artifact_checksum) {
      throw new Error('workspace export tree checksum does not match the integrity manifest');
    }
    return manifest;
  } finally {
    await handle.close();
  }
}

export async function runExportVerify(args: string[]): Promise<number> {
  if (args.length !== 2 || args.some((value) => !value)) {
    process.stderr.write('usage: postshow export verify <workspace.ndjson> <integrity.json>\n');
    return 1;
  }
  const manifest = await verifyWorkspaceExport(args[0]!, args[1]!);
  process.stdout.write(
    `Verified ${manifest.filename}: ${manifest.artifact_bytes.toLocaleString('en-US')} bytes, ` +
      `${manifest.parts.length.toLocaleString('en-US')} parts, ${manifest.artifact_checksum}\n`
  );
  return 0;
}
