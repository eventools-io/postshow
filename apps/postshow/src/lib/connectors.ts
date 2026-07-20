import type { Provider } from './types';

export interface SecretField {
  key: string;
  label: string;
  placeholder: string;
  kind: 'secret' | 'text';
}

export interface ConnectorDef {
  provider: Provider;
  name: string;
  category: 'analytics' | 'revenue' | 'data' | 'dev' | 'outbound' | 'support';
  blurb: string;
  implemented: boolean;
  /** Sources can be marked local-only (raw data never syncs). Outbound
   * connectors (email, chat, issue dispatch) have no raw data to keep, so
   * the option never appears for them. */
  supportsLocalOnly: boolean;
  secretFields: SecretField[];
  metaFields: SecretField[];
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
      { key: 'project_id', label: 'Project ID', placeholder: '12345', kind: 'text' },
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
    blurb: 'Your product database, read-only. Accounts, seats, feature tables.',
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
    metaFields: [{ key: 'repo', label: 'Repository', placeholder: 'org/repo', kind: 'text' }],
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
    metaFields: [{ key: 'team_key', label: 'Team key', placeholder: 'ENG', kind: 'text' }],
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
      { key: 'from', label: 'From address', placeholder: 'you@yourcompany.com', kind: 'text' },
    ],
  },
  {
    provider: 'slack',
    name: 'Slack',
    category: 'outbound',
    blurb: 'The debrief posts to your channel after every run.',
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
      { key: 'org_slug', label: 'Organization slug', placeholder: 'acme', kind: 'text' },
      { key: 'project_slug', label: 'Project slug', placeholder: 'frontend', kind: 'text' },
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
