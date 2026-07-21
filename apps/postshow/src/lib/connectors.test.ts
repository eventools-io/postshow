import { describe, it, expect } from 'vitest';
import { CONNECTORS, canonicalConnectionMeta, connectorFor } from './connectors';

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

  it('canonicalizes routing metadata before target comparison or writes', () => {
    expect(
      canonicalConnectionMeta('posthog', {
        host: ' HTTPS://US.POSTHOG.COM:443/ ',
        project_id: ' 12345 ',
      })
    ).toEqual({ project_id: '12345' });
    expect(
      canonicalConnectionMeta('posthog', {
        host: 'https://EU.POSTHOG.COM:443/',
        project_id: '12345',
      })
    ).toEqual({ host: 'https://eu.posthog.com', project_id: '12345' });
    expect(canonicalConnectionMeta('github', { repo: ' Eventools/Postshow ' })).toEqual({
      repo: 'Eventools/Postshow',
    });
    expect(canonicalConnectionMeta('linear', { team_key: ' eng ' })).toEqual({ team_key: 'ENG' });
    expect(canonicalConnectionMeta('resend', { from: ' Owner@Example.COM ' })).toEqual({
      from: 'owner@example.com',
    });
    expect(
      canonicalConnectionMeta('sentry', {
        org_slug: ' Eventools ',
        project_slug: ' Web_App ',
      })
    ).toEqual({ org_slug: 'eventools', project_slug: 'web_app' });
  });

  it('rejects a PostHog URL that is not a public HTTPS origin', () => {
    for (const host of [
      'http://us.posthog.com',
      'https://us.posthog.com/path',
      'https://user@example.com',
      'https://posthog.internal',
      'https://127.0.0.1',
    ]) {
      expect(() => canonicalConnectionMeta('posthog', { host, project_id: '1' })).toThrow(
        /https origin/i
      );
    }
  });

  it.each([
    ['posthog', { project_id: 'project-1' }],
    ['github', { repo: 'owner/repo/extra' }],
    ['linear', { team_key: '1-BAD' }],
    ['resend', { from: 'not-an-email' }],
    ['sentry', { org_slug: 'bad slug', project_slug: 'frontend' }],
  ] as const)('rejects a noncanonical %s target before an API write', (provider, meta) => {
    expect(() => canonicalConnectionMeta(provider, meta)).toThrow();
  });
});
