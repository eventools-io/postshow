import { describe, it, expect } from 'vitest';
import { CONNECTORS, connectorFor } from './connectors';

// Mirrors the CHECK constraint in the postshow_connections migration; a
// provider the database rejects must never appear in the catalog.
const DB_PROVIDERS = new Set([
  'posthog',
  'stripe',
  'postgres',
  'github',
  'linear',
  'resend',
  'slack',
  'mixpanel',
  'amplitude',
  'ga4',
  'intercom',
  'sentry',
  'hubspot',
  'openreplay',
]);

describe('connector catalog', () => {
  it('has unique providers, all accepted by the database constraint', () => {
    const providers = CONNECTORS.map((c) => c.provider);
    expect(new Set(providers).size).toBe(providers.length);
    for (const provider of providers) {
      expect(DB_PROVIDERS.has(provider)).toBe(true);
    }
  });

  it('every implemented connector collects at least one secret', () => {
    for (const connector of CONNECTORS.filter((c) => c.implemented)) {
      expect(connector.secretFields.length).toBeGreaterThan(0);
    }
  });

  it('ships the eight v1 adapters', () => {
    const implemented = CONNECTORS.filter((c) => c.implemented).map((c) => c.provider);
    expect(implemented.sort()).toEqual(
      ['github', 'linear', 'postgres', 'posthog', 'resend', 'sentry', 'slack', 'stripe'].sort()
    );
  });

  it('offers local-only on sources and never on outbound connectors', () => {
    for (const provider of ['resend', 'slack', 'linear'] as const) {
      expect(connectorFor(provider)?.supportsLocalOnly).toBe(false);
    }
    for (const provider of ['posthog', 'stripe', 'postgres', 'github', 'sentry'] as const) {
      expect(connectorFor(provider)?.supportsLocalOnly).toBe(true);
    }
  });

  it('looks up connectors by provider', () => {
    expect(connectorFor('posthog')?.name).toBe('PostHog');
    expect(connectorFor('ga4')?.implemented).toBe(false);
  });
});
