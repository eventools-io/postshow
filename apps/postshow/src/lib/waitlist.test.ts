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
    expect(await joinWaitlist('not-an-email', 'token', crypto.randomUUID())).toBe('invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the trimmed email and one-use challenge to the Edge admission endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 202 }));
    const requestId = '00000000-0000-4000-8000-000000000001';
    expect(await joinWaitlist('  cj@depth23.online ', 'turnstile-token', requestId)).toBe('joined');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/postshow-waitlist',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId,
          email: 'cj@depth23.online',
          turnstile_token: 'turnstile-token',
        }),
      })
    );
    const headers = new globalThis.Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('apikey')).toBe('test-key');
    expect(headers.has('authorization')).toBe(false);
  });

  it('returns error on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    expect(await joinWaitlist('cj@depth23.online', 'token', crypto.randomUUID())).toBe('error');
  });

  it.each([
    ['empty', '', 202],
    ['HTML', '<html>accepted</html>', 202],
    ['empty object', '{}', 202],
    ['false acknowledgement', '{"ok":false}', 202],
    ['string', '"accepted"', 202],
    ['array', '[{"ok":true}]', 202],
    ['number', '1', 202],
    ['boolean', 'true', 202],
    ['null', 'null', 202],
    ['malformed JSON', '{"ok":true', 202],
    ['wrong successful status', '{"ok":true}', 200],
    ['extra response fields', '{"ok":true,"joined":true}', 202],
  ])('fails closed for a %s response', async (_description, body, status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }));
    expect(await joinWaitlist('cj@depth23.online', 'token', crypto.randomUUID())).toBe('error');
  });

  it('rejects an otherwise valid acknowledgement larger than the response bound', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, padding: 'x'.repeat(1_024) }), { status: 202 })
    );
    expect(await joinWaitlist('cj@depth23.online', 'token', crypto.randomUUID())).toBe('error');
  });

  it('returns error when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    expect(await joinWaitlist('cj@depth23.online', 'token', crypto.randomUUID())).toBe('error');
  });

  it('never calls an endpoint without a Turnstile token and request identity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await joinWaitlist('cj@depth23.online', '', crypto.randomUUID())).toBe('error');
    expect(await joinWaitlist('cj@depth23.online', 'token', '')).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
