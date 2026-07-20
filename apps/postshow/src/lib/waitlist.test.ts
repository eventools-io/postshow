import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidEmail, joinWaitlist } from './waitlist';

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('cj@depth23.online')).toBe(true);
  });

  it('trims whitespace before validating', () => {
    expect(isValidEmail('  cj@depth23.online  ')).toBe(true);
  });

  it('rejects missing domain, missing at-sign, and empty input', () => {
    expect(isValidEmail('cj@depth23')).toBe(false);
    expect(isValidEmail('depth23.online')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects addresses over 320 characters', () => {
    const local = 'a'.repeat(320);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });
});

describe('joinWaitlist', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns invalid without calling fetch for a bad email', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await joinWaitlist('not-an-email')).toBe('invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the trimmed email to the waitlist rpc', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    expect(await joinWaitlist('  cj@depth23.online ')).toBe('joined');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/join_postshow_waitlist',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ p_email: 'cj@depth23.online', p_source: 'landing' }),
      })
    );
  });

  it('returns error on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    expect(await joinWaitlist('cj@depth23.online')).toBe('error');
  });

  it('returns error when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    expect(await joinWaitlist('cj@depth23.online')).toBe('error');
  });
});
