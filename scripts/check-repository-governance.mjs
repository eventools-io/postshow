import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
  'SECURITY.md',
  'SUPPORT.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/pull_request_template.md',
];

const LICENSE_COPIES = [
  'LICENSE',
  'apps/postshow/LICENSE',
  'apps/postshow-desktop/LICENSE',
  'packages/postshow-cli/LICENSE',
  'packages/postshow-core/LICENSE',
];

const ALLOWED_LICENSES = new Set([
  '(Apache-2.0 AND MIT)',
  '(MPL-2.0 OR Apache-2.0)',
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'ISC',
  'MIT',
  'OFL-1.1',
  'Python-2.0',
  'Unlicense',
]);

export function actionReferences(workflow) {
  return workflow
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/u)?.[1])
    .filter(Boolean);
}

export function immutableReference(reference) {
  if (reference.startsWith('./')) return true;
  if (reference.startsWith('docker://')) {
    return /@sha256:[0-9a-f]{64}$/u.test(reference);
  }
  const separator = reference.lastIndexOf('@');
  return separator > 0 && /^[0-9a-f]{40}$/u.test(reference.slice(separator + 1));
}

export function hasWorkflowDefaultPermissions(workflow) {
  return /^permissions:\s*(?:\{\s*\})?\s*(?:\r?\n|$)/mu.test(workflow);
}

export function capturesNpmPackFilenameSafely(workflow) {
  return /package_file="\$\(cd packages\/postshow-cli && npm pack --silent \| tail -n 1\)"/u.test(
    workflow
  );
}

export function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1];
    if (/\bsrc\s*=/iu.test(attributes)) continue;
    scripts.push({ attributes, body: match[2] });
  }
  return scripts;
}

export function inlineScriptHashes(html) {
  return inlineScripts(html).map(
    ({ body }) => `sha256-${createHash('sha256').update(body).digest('base64')}`
  );
}

export function dependencyLicenseArguments({ siteDependencies = false } = {}) {
  const filter = siteDependencies ? ['--filter', '@eventools/postshow'] : [];
  return [...filter, 'licenses', 'list', '--prod', '--json'];
}

export function commandFailureMessage(error) {
  const detail = [error?.stderr, error?.stdout]
    .map((output) => output?.toString().trim())
    .find(Boolean);
  return detail ? `${error.message}\n${detail}` : error.message;
}

function json(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex');
}

function requireEqual(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function checkPackageMetadata(failures) {
  const repositoryUrl = 'https://github.com/eventools-io/postshow.git';
  const issuesUrl = 'https://github.com/eventools-io/postshow/issues';
  const rootPackage = json('package.json');
  const cliPackage = json('packages/postshow-cli/package.json');

  for (const [label, pkg] of [
    ['root package', rootPackage],
    ['CLI package', cliPackage],
  ]) {
    requireEqual(pkg.license, 'MIT', `${label} license`, failures);
    requireEqual(pkg.homepage, 'https://postshow.io', `${label} homepage`, failures);
    requireEqual(pkg.repository?.url, repositoryUrl, `${label} repository`, failures);
    requireEqual(pkg.bugs?.url, issuesUrl, `${label} issue URL`, failures);
    requireEqual(pkg.bugs?.email, 'support@eventools.io', `${label} support email`, failures);
  }

  requireEqual(cliPackage.publishConfig?.access, 'public', 'CLI publish access', failures);
  if (!cliPackage.files?.includes('LICENSE') || !cliPackage.files?.includes('README.md')) {
    failures.push('CLI package files must include LICENSE and README.md');
  }
}

function checkPolicies(failures) {
  for (const path of new Set([...REQUIRED_FILES, ...LICENSE_COPIES])) {
    if (!existsSync(resolve(root, path))) {
      failures.push(`missing required governance file: ${path}`);
    }
  }

  const security = existsSync(resolve(root, 'SECURITY.md'))
    ? readFileSync(resolve(root, 'SECURITY.md'), 'utf8')
    : '';
  const support = existsSync(resolve(root, 'SUPPORT.md'))
    ? readFileSync(resolve(root, 'SUPPORT.md'), 'utf8')
    : '';
  const codeowners = existsSync(resolve(root, '.github/CODEOWNERS'))
    ? readFileSync(resolve(root, '.github/CODEOWNERS'), 'utf8')
    : '';
  if (!security.includes('security@eventools.io')) {
    failures.push('SECURITY.md must contain the canonical security contact');
  }
  if (!support.includes('support@eventools.io')) {
    failures.push('SUPPORT.md must contain the canonical support contact');
  }
  for (const owner of ['@cj-vana', '@jratliff79']) {
    if (!codeowners.includes(owner))
      failures.push(`CODEOWNERS must include verified admin ${owner}`);
  }
}

function checkLicenseCopies(failures) {
  if (LICENSE_COPIES.some((path) => !existsSync(resolve(root, path)))) return;
  const expected = sha256('LICENSE');
  for (const path of LICENSE_COPIES) {
    if (sha256(path) !== expected) failures.push(`${path} differs from the root MIT license`);
  }
  const license = readFileSync(resolve(root, 'LICENSE'), 'utf8');
  if (!license.includes('Copyright (c) 2026 Eventools LLC')) {
    failures.push('MIT license must name Eventools LLC as the copyright holder');
  }
}

function checkDependencyLicenses(failures, { siteDependencies = false } = {}) {
  let licenses;
  try {
    licenses = JSON.parse(
      execFileSync('pnpm', dependencyLicenseArguments({ siteDependencies }), {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  } catch (error) {
    failures.push(
      `could not inventory installed production dependency licenses: ${commandFailureMessage(error)}`
    );
    return;
  }

  if (Object.keys(licenses).length === 0) {
    failures.push('production dependency license inventory was empty');
    return;
  }

  for (const license of Object.keys(licenses)) {
    if (!ALLOWED_LICENSES.has(license)) {
      failures.push(`production dependency license requires review: ${license}`);
    }
  }
}

function checkWorkflows(failures) {
  const workflowsDir = resolve(root, '.github/workflows');
  const automationPaths = readdirSync(workflowsDir)
    .filter((entry) => /\.ya?ml$/u.test(entry))
    .map((name) => `.github/workflows/${name}`);
  const actionsDir = resolve(root, '.github/actions');
  if (existsSync(actionsDir)) {
    for (const name of readdirSync(actionsDir)) {
      for (const manifest of ['action.yml', 'action.yaml']) {
        const path = `.github/actions/${name}/${manifest}`;
        if (existsSync(resolve(root, path))) automationPaths.push(path);
      }
    }
  }

  for (const path of automationPaths) {
    const name = path.split('/').at(-1);
    const workflow = readFileSync(resolve(root, path), 'utf8');

    if (path.startsWith('.github/workflows/') && !hasWorkflowDefaultPermissions(workflow)) {
      failures.push(`${path} must declare workflow-level default permissions`);
    }
    if (
      path.startsWith('.github/workflows/') &&
      /^\s*(pull_request_target|workflow_run):/mu.test(workflow)
    ) {
      failures.push(`${path} uses a privileged trigger that requires a dedicated threat review`);
    }
    for (const reference of actionReferences(workflow)) {
      if (!immutableReference(reference)) {
        failures.push(`${path} uses a mutable action or container reference: ${reference}`);
      }
    }
    if (name === 'publish-release.yml' && !capturesNpmPackFilenameSafely(workflow)) {
      failures.push(`${path} must isolate npm pack's final filename from prepack lifecycle output`);
    }
  }
}

function checkSiteCsp(failures, htmlPath) {
  if (!existsSync(resolve(root, htmlPath))) {
    failures.push(`missing site shell for CSP validation: ${htmlPath}`);
    return;
  }
  const html = readFileSync(resolve(root, htmlPath), 'utf8');
  const netlify = readFileSync(resolve(root, 'apps/postshow/netlify.toml'), 'utf8');
  const scripts = inlineScripts(html);

  if (scripts.length !== 2) {
    failures.push(
      `${htmlPath} must contain exactly two inline JSON-LD scripts, got ${scripts.length}`
    );
  }
  for (const { attributes, body } of scripts) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/iu.test(attributes)) {
      failures.push(`${htmlPath} contains an unexpected executable inline script`);
    }
    try {
      JSON.parse(body);
    } catch {
      failures.push(`${htmlPath} contains invalid inline JSON-LD`);
    }
  }

  const csp = netlify.match(/Content-Security-Policy\s*=\s*"([^"]*)"/u)?.[1];
  if (!csp) {
    failures.push('apps/postshow/netlify.toml is missing Content-Security-Policy');
    return;
  }

  const configured = [...csp.matchAll(/'(sha(?:256|384|512)-[A-Za-z0-9+/=]+)'/gu)]
    .map((match) => match[1])
    .sort();
  const required = inlineScriptHashes(html).sort();
  if (JSON.stringify(configured) !== JSON.stringify(required)) {
    failures.push(
      `inline script CSP hashes are stale: expected ${required.join(', ')}, got ${configured.join(', ')}`
    );
  }
}

export function runGovernanceCheck({
  siteHtmlPath = 'apps/postshow/index.html',
  siteDependencies = false,
} = {}) {
  const failures = [];
  checkPolicies(failures);
  checkPackageMetadata(failures);
  checkLicenseCopies(failures);
  checkDependencyLicenses(failures, { siteDependencies });
  checkWorkflows(failures);
  checkSiteCsp(failures, siteHtmlPath);

  if (failures.length > 0) {
    throw new Error(`Repository governance check failed:\n- ${failures.join('\n- ')}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runGovernanceCheck({
      siteHtmlPath: process.argv.includes('--built-site')
        ? 'apps/postshow/dist/index.html'
        : 'apps/postshow/index.html',
      siteDependencies: process.argv.includes('--site-dependencies'),
    });
    process.stdout.write('Repository governance check passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
