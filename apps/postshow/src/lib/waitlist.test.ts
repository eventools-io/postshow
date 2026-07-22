import { describe, it, expect, vi, afterEach } from 'vitest';
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns invalid without calling fetch for a bad email', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await joinWaitlist('not-an-email', crypto.randomUUID())).toBe('invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the trimmed email and replay-safe identity to the detected Netlify form', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const requestId = '00000000-0000-4000-8000-000000000001';
    expect(await joinWaitlist('  cj@depth23.online ', requestId)).toBe('joined');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/__forms.html',
      expect.objectContaining({
        method: 'POST',
        body:
          'form-name=beta-signup&email=cj%40depth23.online&source=landing&request_id=' + requestId,
      })
    );
    const headers = new globalThis.Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(headers.has('authorization')).toBe(false);
  });

  it('returns error on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    expect(await joinWaitlist('cj@depth23.online', crypto.randomUUID())).toBe('error');
  });

  it('returns error when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    expect(await joinWaitlist('cj@depth23.online', crypto.randomUUID())).toBe('error');
  });

  it('never posts without a valid request identity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await joinWaitlist('cj@depth23.online', '')).toBe('error');
    expect(await joinWaitlist('cj@depth23.online', 'not-a-uuid')).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
