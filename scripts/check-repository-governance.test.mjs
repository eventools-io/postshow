import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionReferences,
  commandFailureMessage,
  capturesNpmPackFilenameSafely,
  dependencyLicenseArguments,
  hasWorkflowDefaultPermissions,
  immutableReference,
  inlineScriptHashes,
  inlineScripts,
} from './check-repository-governance.mjs';

test('keeps repository and site dependency license inventories distinct', () => {
  assert.deepEqual(dependencyLicenseArguments(), ['licenses', 'list', '--prod', '--json']);
  assert.deepEqual(dependencyLicenseArguments({ siteDependencies: true }), [
    '--filter',
    '@eventools/postshow',
    'licenses',
    'list',
    '--prod',
    '--json',
  ]);
});

test('includes captured command diagnostics in governance failures', () => {
  assert.equal(
    commandFailureMessage({ message: 'command failed', stderr: 'missing package index\n' }),
    'command failed\nmissing package index'
  );
  assert.equal(commandFailureMessage({ message: 'command failed' }), 'command failed');
});

test('isolates npm pack filename from lifecycle output', () => {
  assert.equal(
    capturesNpmPackFilenameSafely(
      'package_file="$(cd packages/postshow-cli && npm pack --silent | tail -n 1)"'
    ),
    true
  );
  assert.equal(
    capturesNpmPackFilenameSafely(
      'package_file="$(cd packages/postshow-cli && npm pack --silent)"'
    ),
    false
  );
});

test('extracts action, local, and Docker uses references without comments', () => {
  const workflow = `
steps:
  - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v5
  - uses: ./local-action
  - uses: docker://alpine@sha256:${'a'.repeat(64)}
`;

  assert.deepEqual(actionReferences(workflow), [
    'actions/checkout@0123456789abcdef0123456789abcdef01234567',
    './local-action',
    `docker://alpine@sha256:${'a'.repeat(64)}`,
  ]);
});

test('accepts immutable and local references', () => {
  assert.equal(
    immutableReference('actions/checkout@0123456789abcdef0123456789abcdef01234567'),
    true
  );
  assert.equal(immutableReference('./.github/actions/local'), true);
  assert.equal(immutableReference(`docker://alpine@sha256:${'b'.repeat(64)}`), true);
});

test('extracts pinned references from composite action manifests', () => {
  const action = `
runs:
  using: composite
  steps:
    - uses: actions/setup-node@0123456789abcdef0123456789abcdef01234567
`;
  assert.deepEqual(actionReferences(action), [
    'actions/setup-node@0123456789abcdef0123456789abcdef01234567',
  ]);
});

test('rejects tags, branches, abbreviated SHAs, and mutable Docker tags', () => {
  for (const reference of [
    'actions/checkout@v5',
    'actions/checkout@main',
    'actions/checkout@0123456',
    'docker://alpine:3.22',
  ]) {
    assert.equal(immutableReference(reference), false, reference);
  }
});

test('requires an explicit workflow-level permissions default', () => {
  assert.equal(hasWorkflowDefaultPermissions('permissions:\n  contents: read\n'), true);
  assert.equal(hasWorkflowDefaultPermissions('permissions: {}\n'), true);
  assert.equal(hasWorkflowDefaultPermissions('permissions: write-all\n'), false);
  assert.equal(hasWorkflowDefaultPermissions('jobs:\n  test:\n    permissions: {}\n'), false);
});

test('hashes exact inline script bytes and ignores external scripts', () => {
  const html = `<script type="application/ld+json">\n{"ok":true}\n</script>\n<script type="module" src="/main.js"></script>`;
  assert.deepEqual(inlineScripts(html), [
    { attributes: ' type="application/ld+json"', body: '\n{"ok":true}\n' },
  ]);
  assert.deepEqual(inlineScriptHashes(html), [
    'sha256-stz74J1CeLrnM9uDfJE+CpYtE4Mnw6tY7WvXnusiQS0=',
  ]);
});

test('inline script hashes change when whitespace changes', () => {
  const compact = '<script>{"ok":true}</script>';
  const indented = '<script> {"ok":true}</script>';
  assert.notDeepEqual(inlineScriptHashes(compact), inlineScriptHashes(indented));
});
