import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_WEB_URL,
  PRODUCTION_WEB_URL,
  classifyNavigation,
  isTrustedRendererUrl,
  resolveWebUrl,
} from './navigation';

describe('resolveWebUrl', () => {
  it('ignores every environment override in a packaged build', () => {
    expect(resolveWebUrl(true, 'https://attacker.example')).toBe(PRODUCTION_WEB_URL);
    expect(resolveWebUrl(true, 'javascript:alert(1)')).toBe(PRODUCTION_WEB_URL);
  });

  it('uses only the exact development origins on port 5176', () => {
    expect(resolveWebUrl(false)).toBe(DEVELOPMENT_WEB_URL);
    expect(resolveWebUrl(false, 'http://127.0.0.1:5176')).toBe('http://127.0.0.1:5176');
    expect(() => resolveWebUrl(false, 'http://localhost:5173')).toThrow(/exactly/);
    expect(() => resolveWebUrl(false, 'http://localhost:5176/path')).toThrow(/exactly/);
    expect(() => resolveWebUrl(false, 'http://user:pass@localhost:5176')).toThrow(/exactly/);
  });
});

describe('classifyNavigation', () => {
  it('allows only the configured renderer origin in-window', () => {
    expect(
      classifyNavigation('https://postshow.io/settings?tab=engine', PRODUCTION_WEB_URL)
    ).toEqual({
      action: 'allow',
      url: 'https://postshow.io/settings?tab=engine',
    });
    expect(isTrustedRendererUrl('https://postshow.io/inbox', PRODUCTION_WEB_URL)).toBe(true);
    expect(isTrustedRendererUrl('https://postshow.io.evil.example/inbox', PRODUCTION_WEB_URL)).toBe(
      false
    );
  });

  it('hands only explicit customer-facing destinations to the system browser', () => {
    expect(classifyNavigation('https://eventools.io/blog', PRODUCTION_WEB_URL).action).toBe(
      'external'
    );
    expect(classifyNavigation('https://status.eventools.io', PRODUCTION_WEB_URL).action).toBe(
      'external'
    );
    expect(
      classifyNavigation('https://checkout.stripe.com/c/pay/cs_test_123', PRODUCTION_WEB_URL).action
    ).toBe('external');
    expect(
      classifyNavigation('https://billing.stripe.com/p/session/test_123', PRODUCTION_WEB_URL).action
    ).toBe('external');
    expect(classifyNavigation('mailto:security@eventools.io', PRODUCTION_WEB_URL).action).toBe(
      'external'
    );
    expect(classifyNavigation('mailto:support@eventools.io', PRODUCTION_WEB_URL).action).toBe(
      'external'
    );
  });

  it.each([
    'https://attacker.example',
    'https://postshow.io.evil.example',
    'https://status.eventools.io.evil.example',
    'http://status.eventools.io',
    'http://postshow.io',
    'https://user:pass@postshow.io',
    'javascript:alert(1)',
    'data:text/html,bad',
    'file:///tmp/bad',
    'postshow://unexpected',
    'mailto:attacker@example.com',
    'mailto:support@eventools.io?subject=untrusted',
    'mailto:support+other@eventools.io',
  ])('denies %s', (url) => {
    expect(classifyNavigation(url, PRODUCTION_WEB_URL)).toEqual({ action: 'deny' });
  });
});
