import type { Provider } from './types';

export interface SecretField {
  key: string;
  label: string;
  placeholder: string;
  kind: 'secret' | 'text';
  required?: boolean;
}

export interface ConnectorDef {
  provider: Provider;
  name: string;
  category: 'analytics' | 'revenue' | 'data' | 'dev' | 'outbound' | 'support';
  blurb: string;
  implemented: boolean;
  /** Sources can be configured on-device so credentials and source data never sync to Postshow. Outbound
   * connectors (email, chat, issue dispatch) have no raw data to keep, so
   * the option never appears for them. */
  supportsLocalOnly: boolean;
  secretFields: SecretField[];
  metaFields: SecretField[];
}

export const DEFAULT_POSTHOG_HOST = 'https://us.posthog.com';

function metaString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Connection target metadata is invalid.');
  return value.trim();
}

function canonicalPosthogHost(value: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PostHog host must be a valid HTTPS origin.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z][a-z0-9-]{0,62}$/.test(url.origin) ||
    /(?:\.\.|\.-|-\.)/.test(url.hostname) ||
    /\.(?:local|internal|localhost)$/.test(url.hostname)
  ) {
    throw new Error('PostHog host must be a lowercase public HTTPS origin without a path.');
  }
  return url.origin === DEFAULT_POSTHOG_HOST ? undefined : url.origin;
}

/** Canonical routing metadata shared by target-change checks and API writes.
 * This deliberately leaves GitHub repository case intact because the current
 * database authority treats a case change as a distinct target. */
export function canonicalConnectionMeta(
  provider: Provider,
  meta: Record<string, unknown>
): Record<string, string> {
  switch (provider) {
    case 'posthog': {
      const canonical: Record<string, string> = {};
      const host = canonicalPosthogHost(metaString(meta, 'host'));
      const projectId = metaString(meta, 'project_id');
      if (projectId && !/^[0-9]{1,20}$/.test(projectId)) {
        throw new Error('PostHog project ID must contain only digits.');
      }
      if (host) canonical.host = host;
      if (projectId) canonical.project_id = projectId;
      return canonical;
    }
    case 'github': {
      const repo = metaString(meta, 'repo');
      if (
        repo &&
        (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) ||
          repo.split('/').some((part) => part === '.' || part === '..'))
      ) {
        throw new Error('GitHub repository must use the exact owner/repository form.');
      }
      return repo ? { repo } : {};
    }
    case 'linear': {
      const teamKey = metaString(meta, 'team_key').toUpperCase();
      if (teamKey && !/^[A-Z][A-Z0-9]{0,19}$/.test(teamKey)) {
        throw new Error('Linear team key must start with a letter and use up to 20 characters.');
      }
      return teamKey ? { team_key: teamKey } : {};
    }
    case 'resend': {
      const from = metaString(meta, 'from').toLowerCase();
      if (from && (from.length > 320 || !/^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(from))) {
        throw new Error('Resend sender must be a valid email address.');
      }
      return from ? { from } : {};
    }
    case 'sentry': {
      const orgSlug = metaString(meta, 'org_slug').toLowerCase();
      const projectSlug = metaString(meta, 'project_slug').toLowerCase();
      if (
        (orgSlug && !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(orgSlug)) ||
        (projectSlug && !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(projectSlug))
      ) {
        throw new Error('Sentry slugs may contain only letters, numbers, underscores, and dashes.');
      }
      return {
        ...(orgSlug ? { org_slug: orgSlug } : {}),
        ...(projectSlug ? { project_slug: projectSlug } : {}),
      };
    }
    default:
      return {};
  }
}

/** The connector catalog. `implemented` connectors have a live adapter in the
 * agent runtime; the rest appear as "on the roadmap" and record interest. */
export const CONNECTORS: ConnectorDef[] = [
  {
    provider: 'posthog',
    name: 'PostHog',
    category: 'analytics',
    blurb: 'Events, sessions, and replays. The primary source for the watcher.',
    implemented: true,
    supportsLocalOnly: true,
    secretFields: [
      { key: 'api_key', label: 'Personal API key', placeholder: 'phx_...', kind: 'secret' },
    ],
    metaFields: [
      { key: 'host', label: 'Host', placeholder: 'https://us.posthog.com', kind: 'text' },
      {
        key: 'project_id',
        label: 'Project ID',
        placeholder: '12345',
        kind: 'text',
        required: true,
      },
    ],
  },
  {
    provider: 'stripe',
    name: 'Stripe',
    category: 'revenue',
    blurb: 'Subscriptions, MRR, and churn signals per account.',
    implemented: true,
    supportsLocalOnly: true,
    secretFields: [
      {
        key: 'api_key',
        label: 'Restricted API key (read-only)',
        placeholder: 'rk_live_...',
        kind: 'secret',
      },
    ],
    metaFields: [],
  },
  {
    provider: 'postgres',
    name: 'Postgres',
    category: 'data',
    blurb: 'Device-only: one owner-configured, bounded read-only SELECT; remote TLS required.',
    implemented: true,
    supportsLocalOnly: true,
    secretFields: [
      {
        key: 'connection_string',
        label: 'Read-only connection string',
        placeholder: 'postgresql://readonly:...@host:5432/db',
        kind: 'secret',
      },
    ],
    metaFields: [],
  },
  {
    provider: 'github',
    name: 'GitHub',
    category: 'dev',
    blurb: 'Correlate metric moves with merged PRs; file drafted issues.',
    implemented: true,
    supportsLocalOnly: true,
    secretFields: [
      { key: 'token', label: 'Fine-grained token', placeholder: 'github_pat_...', kind: 'secret' },
    ],
    metaFields: [
      {
        key: 'repo',
        label: 'Repository',
        placeholder: 'org/repo',
        kind: 'text',
        required: true,
      },
    ],
  },
  {
    provider: 'linear',
    name: 'Linear',
    category: 'dev',
    blurb: 'File drafted friction tickets straight into your triage.',
    implemented: true,
    supportsLocalOnly: false,
    secretFields: [
      { key: 'api_key', label: 'API key', placeholder: 'lin_api_...', kind: 'secret' },
    ],
    metaFields: [
      {
        key: 'team_key',
        label: 'Team key',
        placeholder: 'ENG',
        kind: 'text',
        required: true,
      },
    ],
  },
  {
    provider: 'resend',
    name: 'Resend',
    category: 'outbound',
    blurb: 'Send approved outreach drafts from your own domain.',
    implemented: true,
    supportsLocalOnly: false,
    secretFields: [{ key: 'api_key', label: 'API key', placeholder: 're_...', kind: 'secret' }],
    metaFields: [
      {
        key: 'from',
        label: 'Verified from address',
        placeholder: 'you@yourcompany.com',
        kind: 'text',
        required: true,
      },
    ],
  },
  {
    provider: 'slack',
    name: 'Slack',
    category: 'outbound',
    blurb: 'Post an explicitly confirmed connection test to your channel.',
    implemented: true,
    supportsLocalOnly: false,
    secretFields: [
      {
        key: 'webhook_url',
        label: 'Incoming webhook URL',
        placeholder: 'https://hooks.slack.com/services/...',
        kind: 'secret',
      },
    ],
    metaFields: [],
  },
  {
    provider: 'sentry',
    name: 'Sentry',
    category: 'dev',
    blurb: 'Tie session friction to the exceptions behind it.',
    implemented: true,
    supportsLocalOnly: true,
    secretFields: [
      { key: 'token', label: 'Auth token', placeholder: 'sntrys_...', kind: 'secret' },
    ],
    metaFields: [
      {
        key: 'org_slug',
        label: 'Organization slug',
        placeholder: 'acme',
        kind: 'text',
        required: true,
      },
      {
        key: 'project_slug',
        label: 'Project slug',
        placeholder: 'frontend',
        kind: 'text',
        required: true,
      },
    ],
  },
  {
    provider: 'intercom',
    name: 'Intercom',
    category: 'support',
    blurb: 'What customers say, next to what they do.',
    implemented: false,
    supportsLocalOnly: true,
    secretFields: [],
    metaFields: [],
  },
  {
    provider: 'hubspot',
    name: 'HubSpot',
    category: 'revenue',
    blurb: 'Sync next moves and account intel into your CRM.',
    implemented: false,
    supportsLocalOnly: true,
    secretFields: [],
    metaFields: [],
  },
  {
    provider: 'mixpanel',
    name: 'Mixpanel',
    category: 'analytics',
    blurb: 'Event analytics as a watcher source.',
    implemented: false,
    supportsLocalOnly: true,
    secretFields: [],
    metaFields: [],
  },
  {
    provider: 'amplitude',
    name: 'Amplitude',
    category: 'analytics',
    blurb: 'Event analytics as a watcher source.',
    implemented: false,
    supportsLocalOnly: true,
    secretFields: [],
    metaFields: [],
  },
  {
    provider: 'ga4',
    name: 'Google Analytics 4',
    category: 'analytics',
    blurb: 'Marketing-site traffic beside product behavior.',
    implemented: false,
    supportsLocalOnly: true,
    secretFields: [],
    metaFields: [],
  },
  {
    provider: 'openreplay',
    name: 'OpenReplay',
    category: 'analytics',
    blurb: 'Self-hosted session replay as a watcher source.',
    implemented: false,
    supportsLocalOnly: true,
    secretFields: [],
    metaFields: [],
  },
];

export function connectorFor(provider: Provider): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.provider === provider);
}
