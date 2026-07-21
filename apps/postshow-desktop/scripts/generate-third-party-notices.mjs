import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(projectRoot, '../..');
const cliRoot = join(workspaceRoot, 'packages/postshow-cli');

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const UNLICENSE = `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

function manifestAt(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}

function packageRoot(name, basedir) {
  const require = createRequire(join(basedir, '__postshow_license_resolver.cjs'));
  let resolved;
  try {
    resolved = require.resolve(`${name}/package.json`);
  } catch {
    resolved = require.resolve(name);
  }
  for (let cursor = dirname(resolved); cursor !== dirname(cursor); cursor = dirname(cursor)) {
    const manifestPath = join(cursor, 'package.json');
    if (!existsSync(manifestPath)) continue;
    try {
      if (JSON.parse(readFileSync(manifestPath, 'utf8')).name === name) return cursor;
    } catch {
      // Keep walking; package-manager metadata directories may contain JSON
      // that is unrelated to the resolved package.
    }
  }
  throw new Error(`could not resolve package root for ${name}`);
}

function authorLabel(author) {
  if (typeof author === 'string' && author.trim()) return author.trim();
  if (author && typeof author === 'object' && typeof author.name === 'string') return author.name;
  return 'the package authors';
}

function licenseText(root, manifest) {
  const files = readdirSync(root)
    .filter((name) => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(name))
    .sort();
  if (files.length) {
    return files.map((name) => readFileSync(join(root, name), 'utf8').trim()).join('\n\n');
  }
  if (manifest.name.startsWith('@napi-rs/keyring-')) {
    const parent = packageRoot('@napi-rs/keyring', projectRoot);
    return licenseText(parent, manifestAt(parent));
  }
  if (manifest.license === 'MIT') {
    return `Copyright (c) ${authorLabel(manifest.author)}\n\n${MIT}`;
  }
  if (manifest.license === 'Unlicense') return UNLICENSE;
  throw new Error(`${manifest.name}@${manifest.version} has no distributable license text`);
}

const packages = new Map();
function includeRoot(root, recurse = true) {
  const manifest = manifestAt(root);
  const key = `${manifest.name}@${manifest.version}`;
  if (packages.has(key)) return;
  packages.set(key, { root, manifest });
  if (!recurse) return;
  for (const [name, optional] of [
    ...Object.keys(manifest.dependencies ?? {}).map((name) => [name, false]),
    ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => [name, true]),
  ]) {
    try {
      includeRoot(packageRoot(name, root));
    } catch (error) {
      if (!optional) throw error;
    }
  }
}

const desktopManifest = manifestAt(projectRoot);
for (const name of [
  ...Object.keys(desktopManifest.dependencies ?? {}),
  ...Object.keys(desktopManifest.optionalDependencies ?? {}),
]) {
  includeRoot(packageRoot(name, projectRoot));
}
for (const name of ['zod', 'postgres']) includeRoot(packageRoot(name, cliRoot));
// Only the CLI library graph is bundled into desktop, not its executable/MCP
// dependencies. Its external runtime imports are listed explicitly above.
includeRoot(cliRoot, false);
includeRoot(join(workspaceRoot, 'packages/postshow-core'), false);

const sections = [...packages.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, { root, manifest }]) =>
    [
      `## ${key}`,
      `License: ${manifest.license ?? 'see text'}`,
      '',
      licenseText(root, manifest),
    ].join('\n')
  );
const output = [
  'POSTSHOW THIRD-PARTY SOFTWARE NOTICES',
  '',
  'This file is generated from the exact production dependency graph used by the desktop build.',
  'Postshow itself is licensed separately in the adjacent LICENSE file.',
  '',
  ...sections.flatMap((section) => [section, '']),
].join('\n');
writeFileSync(join(projectRoot, 'out/THIRD_PARTY_NOTICES.txt'), output, 'utf8');
