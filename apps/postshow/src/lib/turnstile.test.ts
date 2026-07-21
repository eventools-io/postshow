import { describe, expect, it } from 'vitest';
import { resolveTurnstileClientConfig } from './turnstile';

describe('Turnstile release configuration', () => {
  it('fails closed in production without a site key and ignores bypass', () => {
    expect(resolveTurnstileClientConfig({ production: true, siteKey: '', bypass: 'true' })).toEqual(
      {
        kind: 'blocked',
        message:
          'Security verification is not configured. Account access is temporarily unavailable.',
      }
    );
  });

  it('allows only an explicit non-production bypass', () => {
    expect(
      resolveTurnstileClientConfig({ production: false, siteKey: '', bypass: 'true' })
    ).toEqual({ kind: 'bypass' });
    expect(resolveTurnstileClientConfig({ production: false, siteKey: '', bypass: '1' }).kind).toBe(
      'blocked'
    );
  });

  it('uses the real widget whenever a site key is configured', () => {
    expect(
      resolveTurnstileClientConfig({
        production: true,
        siteKey: ' 1x00000000000000000000AA ',
        bypass: 'false',
      })
    ).toEqual({ kind: 'widget', siteKey: '1x00000000000000000000AA' });
  });
});
