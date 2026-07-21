import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFile, listPackage, statFile } from '@electron/asar';

function findAsars(path) {
  if (!existsSync(path)) return [];
  const details = statSync(path);
  if (details.isFile()) return path.endsWith('app.asar') ? [path] : [];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === 'app.asar')
    .map((entry) => resolve(entry.parentPath, entry.name));
}

const requested = process.argv.slice(2);
const archives = [...new Set((requested.length ? requested : ['dist']).flatMap(findAsars))];
if (archives.length === 0) {
  throw new Error('no packaged app.asar archives were supplied or found under dist');
}

const forbidden = [
  /^\/(?:src|test|tests|coverage|\.github)(?:\/|$)/i,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/i,
  /\/(?:tsconfig|vitest\.config|eslint\.config)[^/]*$/i,
  /\/node_modules\/(?:postshow|@eventools\/postshow-core)(?:\/|$)/,
  /\/node_modules\/(?:@modelcontextprotocol|@hono|hono)(?:\/|$)/,
  /\/node_modules\/(?:electron-builder|typescript|vitest|tsup)(?:\/|$)/,
];

for (const archive of archives) {
  const entries = listPackage(archive, { isPack: false }).map((entry) =>
    entry.startsWith('/') ? entry : `/${entry}`
  );
  const files = new Set(entries);
  for (const required of [
    '/package.json',
    '/LICENSE',
    '/out/main/index.js',
    '/out/main/keyring-selftest.js',
    '/out/THIRD_PARTY_NOTICES.txt',
    '/out/preload/index.cjs',
    '/node_modules/electron-updater/package.json',
    '/node_modules/@napi-rs/keyring/package.json',
    '/node_modules/undici/package.json',
  ]) {
    if (!files.has(required)) throw new Error(`${archive} is missing required ${required}`);
  }

  for (const entry of entries) {
    const top = entry.split('/')[1];
    if (!['out', 'node_modules', 'package.json', 'LICENSE'].includes(top)) {
      throw new Error(`${archive} contains unexpected application-root entry ${entry}`);
    }
    const matched = forbidden.find((pattern) => pattern.test(entry));
    if (matched) throw new Error(`${archive} contains forbidden development content ${entry}`);
  }

  const notices = extractFile(archive, 'out/THIRD_PARTY_NOTICES.txt').toString('utf8');
  for (const packageJson of entries.filter((entry) =>
    /^\/node_modules\/(?:@[^/]+\/[^/]+|[^/]+)\/package\.json$/.test(entry)
  )) {
    const manifest = JSON.parse(extractFile(archive, packageJson.slice(1)).toString('utf8'));
    if (!notices.includes(`## ${manifest.name}@${manifest.version}\n`)) {
      throw new Error(
        `${archive} has no third-party notice for ${manifest.name}@${manifest.version}`
      );
    }
  }
  for (const bundled of ['@eventools/postshow-core@', 'postshow@', 'postgres@', 'zod@']) {
    if (!notices.includes(`## ${bundled}`)) {
      throw new Error(`${archive} has no notice for bundled dependency ${bundled}`);
    }
  }

  const normalizedArchive = archive.toLowerCase();
  const platform = normalizedArchive.includes('win') ? 'win32' : 'darwin';
  const requiredNativePackages =
    platform === 'darwin'
      ? ['keyring-darwin-arm64', 'keyring-darwin-x64']
      : normalizedArchive.includes('win-arm64')
        ? ['keyring-win32-arm64-msvc']
        : ['keyring-win32-x64-msvc'];
  const forbiddenNative = platform === 'win32' ? 'keyring-darwin-' : 'keyring-win32-';
  const nativeEntries = [];
  for (const packageName of requiredNativePackages) {
    const packageEntries = entries.filter(
      (entry) =>
        entry.startsWith(`/node_modules/@napi-rs/${packageName}/`) && entry.endsWith('.node')
    );
    if (packageEntries.length === 0) {
      throw new Error(`${archive} has no native credential-store binary for ${packageName}`);
    }
    nativeEntries.push(...packageEntries);
  }
  if (entries.some((entry) => entry.includes(`/@napi-rs/${forbiddenNative}`))) {
    throw new Error(`${archive} contains native credential binaries for the wrong platform`);
  }
  for (const entry of nativeEntries) {
    if (!statFile(archive, entry.slice(1)).unpacked) {
      throw new Error(`${archive} stores native credential binary inside ASAR: ${entry}`);
    }
  }

  process.stdout.write(`verified ${archive}: ${entries.length} packaged entries\n`);
}
