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
];

const DEP_RULES: { provider: string; deps: string[] }[] = [
  { provider: 'posthog', deps: ['posthog-js', 'posthog-node'] },
  { provider: 'stripe', deps: ['stripe', '@stripe/stripe-js'] },
  { provider: 'sentry', deps: ['@sentry/browser', '@sentry/node', '@sentry/react'] },
  { provider: 'resend', deps: ['resend'] },
];

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
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}
