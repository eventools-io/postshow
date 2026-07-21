// Stack detection for the setup wizard: scan the working directory's env
// files and package manifest for connector credentials and SDKs, the way
// PostHog's wizard detects frameworks. Detection reads local files only and
// races each probe against a shared timeout; a failed probe is a skipped
// probe, never a failed wizard.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedConnector {
  provider: string;
  /** Where the hint came from, for the wizard's explanation line. */
  evidence: string;
  /** Pre-filled secret when an env var held one. */
  secret?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.production'];

interface EnvRule {
  provider: string;
  pattern: RegExp;
  toSecret?: (value: string) => Record<string, unknown>;
}

const ENV_RULES: EnvRule[] = [
  { provider: 'posthog', pattern: /^(POSTHOG_(PERSONAL_)?API_KEY|PH_API_KEY)=(.+)$/m },
  {
    provider: 'stripe',
    pattern: /^STRIPE_(SECRET_KEY|API_KEY)=(sk_|rk_)/m,
  },
  { provider: 'sentry', pattern: /^SENTRY_(AUTH_TOKEN|DSN)=/m },
  { provider: 'resend', pattern: /^RESEND_API_KEY=/m },
  { provider: 'linear', pattern: /^LINEAR_API_KEY=/m },
  { provider: 'github', pattern: /^(GITHUB_TOKEN|GH_TOKEN)=/m },
  { provider: 'slack', pattern: /^SLACK_WEBHOOK_URL=/m },
  // Presence is only a setup hint. Never parse or prefill the connection
  // string: it remains behind the masked credential prompt and native store.
  { provider: 'postgres', pattern: /^DATABASE_URL=/m },
];

const DEP_RULES: { provider: string; deps: string[] }[] = [
  { provider: 'posthog', deps: ['posthog-js', 'posthog-node'] },
  { provider: 'stripe', deps: ['stripe', '@stripe/stripe-js'] },
  { provider: 'sentry', deps: ['@sentry/browser', '@sentry/node', '@sentry/react'] },
  { provider: 'resend', deps: ['resend'] },
];

export const OLLAMA_PROBE_TIMEOUT_MS = 1500;
const MAX_OLLAMA_RESPONSE_BYTES = 1024 * 1024;

function ollamaTagsUrl(raw: string): string | null {
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return null;
  }
  const hostname = base.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  const loopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.');
  if (
    !loopback ||
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  ) {
    return null;
  }
  return new URL('/api/tags', base.origin).href;
}

export function detectConnectors(cwd: string): DetectedConnector[] {
  const found = new Map<string, DetectedConnector>();

  for (const file of ENV_FILES) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    let content = '';
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const rule of ENV_RULES) {
      if (found.has(rule.provider)) continue;
      if (rule.pattern.test(content)) {
        found.set(rule.provider, { provider: rule.provider, evidence: `${file}` });
      }
    }
  }

  const manifestPath = join(cwd, 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...manifest.dependencies, ...manifest.devDependencies };
      for (const rule of DEP_RULES) {
        if (found.has(rule.provider)) continue;
        const hit = rule.deps.find((dep) => dep in deps);
        if (hit)
          found.set(rule.provider, { provider: rule.provider, evidence: `package.json (${hit})` });
      }
    } catch {
      // Unreadable manifest just means no dependency hints.
    }
  }

  return [...found.values()];
}

/** Ollama liveness probe for the local engine path. */
export async function detectOllama(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  const tagsUrl = ollamaTagsUrl(baseUrl);
  if (!tagsUrl) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(tagsUrl, {
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok || (response.status >= 300 && response.status < 400)) return [];

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_OLLAMA_RESPONSE_BYTES) return [];
    if (!response.body) return [];

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_OLLAMA_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          return [];
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const models = (parsed as { models?: unknown }).models;
    if (!Array.isArray(models)) return [];
    return models.flatMap((model) => {
      if (!model || typeof model !== 'object' || Array.isArray(model)) return [];
      const name = (model as { name?: unknown }).name;
      return typeof name === 'string' && name.length <= 300 ? [name] : [];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
