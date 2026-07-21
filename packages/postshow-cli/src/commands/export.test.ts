import { createHash } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyWorkspaceExport } from './export';

const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const filename = `postshow-workspace-${workspaceId}-${requestId}.ndjson`;
let directory: string;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const first = Buffer.from('{"section":"workspace","record":{"name":"Acme"}}\n');
  const second = Buffer.from('{"section":"accounts","record":{"name":"Northstar"}}\n');
  const parts = [first, second].map((bytes, index) => ({
    part_number: index + 1,
    byte_size: bytes.byteLength,
    sha256: sha256(bytes),
  }));
  const artifact = Buffer.concat([first, second]);
  const manifest = {
    manifest_type: 'postshow_workspace_export_integrity',
    manifest_version: 1,
    export_schema_version: 3,
    request_id: requestId,
    workspace_id: workspaceId,
    format: 'postshow-workspace-ndjson',
    filename,
    snapshot_at: '2026-07-20T10:00:01.000Z',
    record_count: 2,
    content_type: 'application/x-ndjson',
    artifact_bytes: artifact.byteLength,
    checksum_algorithm: 'sha256-part-tree-v1',
    artifact_checksum: sha256(
      parts.map((part) => `${part.part_number}:${part.byte_size}:${part.sha256}`).join('\n')
    ),
    parts,
  };
  return { artifact, manifest };
}

async function writeFixture() {
  const value = fixture();
  const artifactPath = join(directory, filename);
  const manifestPath = `${artifactPath}.integrity.json`;
  await writeFile(artifactPath, value.artifact);
  await writeFile(manifestPath, `${JSON.stringify(value.manifest)}\n`);
  return { ...value, artifactPath, manifestPath };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'postshow-export-verify-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('workspace export integrity verifier', () => {
  it('verifies exact multipart boundaries, part hashes, and the tree checksum', async () => {
    const value = await writeFixture();
    await expect(
      verifyWorkspaceExport(value.artifactPath, value.manifestPath)
    ).resolves.toMatchObject({
      filename,
      artifact_bytes: value.artifact.byteLength,
      artifact_checksum: value.manifest.artifact_checksum,
    });
  });

  it('rejects same-size tampering at the affected part', async () => {
    const value = await writeFixture();
    const tampered = Buffer.from(value.artifact);
    tampered[4] = tampered[4]! ^ 1;
    await writeFile(value.artifactPath, tampered);

    await expect(verifyWorkspaceExport(value.artifactPath, value.manifestPath)).rejects.toThrow(
      /part 1/i
    );
  });

  it('rejects truncation and extension before treating an artifact as verified', async () => {
    const value = await writeFixture();
    await writeFile(value.artifactPath, value.artifact.subarray(0, -1));
    await expect(verifyWorkspaceExport(value.artifactPath, value.manifestPath)).rejects.toThrow(
      /byte size/i
    );

    await writeFile(value.artifactPath, Buffer.concat([value.artifact, Buffer.from('x')]));
    await expect(verifyWorkspaceExport(value.artifactPath, value.manifestPath)).rejects.toThrow(
      /byte size/i
    );
  });

  it('rejects a substituted tree checksum even when every declared part is valid', async () => {
    const value = await writeFixture();
    await writeFile(
      value.manifestPath,
      JSON.stringify({ ...value.manifest, artifact_checksum: 'f'.repeat(64) })
    );

    await expect(verifyWorkspaceExport(value.artifactPath, value.manifestPath)).rejects.toThrow(
      /tree checksum/i
    );
  });

  it('rejects schema drift, forged boundaries, and renamed artifacts', async () => {
    const value = await writeFixture();
    await writeFile(value.manifestPath, JSON.stringify({ ...value.manifest, extra: true }));
    await expect(verifyWorkspaceExport(value.artifactPath, value.manifestPath)).rejects.toThrow(
      /unexpected.*shape/i
    );

    const forged = fixture();
    forged.manifest.parts[0]!.byte_size -= 1;
    forged.manifest.parts[1]!.byte_size += 1;
    await writeFile(value.manifestPath, JSON.stringify(forged.manifest));
    await expect(verifyWorkspaceExport(value.artifactPath, value.manifestPath)).rejects.toThrow(
      /part 1/i
    );

    await writeFile(value.manifestPath, JSON.stringify(value.manifest));
    const renamed = join(directory, 'renamed.ndjson');
    await rename(value.artifactPath, renamed);
    await expect(verifyWorkspaceExport(renamed, value.manifestPath)).rejects.toThrow(/filename/i);
  });
});
