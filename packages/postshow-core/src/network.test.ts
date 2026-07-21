import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADAPTER_TIMEOUT_MS, linearTest, privacySafeUrl, resendTest, stripeTest } from './adapters';
import { callModel, MODEL_TIMEOUT_MS } from './engine';
import { isLoopbackHostname, isNonPublicIpLiteral, isUnsafePublicHostname } from './network';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function abortablePendingFetch() {
  return vi.fn(
    async (_url: string, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('runtime abort shape')));
      })
  );
}

function stalledBodyFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () =>
          controller.error(new Error('runtime abort shape'))
        );
      },
    });
    return new Response(stream, { status: 200 });
  });
}

describe('network deadlines', () => {
  it('bounds the entire model request and normalizes runtime abort errors', async () => {
    vi.useFakeTimers();
    const fetchStub = abortablePendingFetch();
    vi.stubGlobal('fetch', fetchStub);

    const pending = callModel(
      {
        taskClass: 'narration',
        mode: 'byok',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        effort: 'low',
        baseUrl: '',
      },
      'sk-test',
      { system: 'system', prompt: 'prompt' }
    );
    const assertion = expect(pending).rejects.toThrow('model call timed out');
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    await assertion;
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('bounds connector requests and normalizes runtime abort errors', async () => {
    vi.useFakeTimers();
    const fetchStub = abortablePendingFetch();
    vi.stubGlobal('fetch', fetchStub);

    const pending = stripeTest({ api_key: 'rk_test' });
    const assertion = expect(pending).rejects.toThrow('connector request timed out');
    await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS);
    await assertion;
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('keeps the model deadline active through response-body streaming', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stalledBodyFetch());

    const pending = callModel(
      {
        taskClass: 'narration',
        mode: 'byok',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        effort: 'low',
        baseUrl: '',
      },
      'sk-test',
      { system: 'system', prompt: 'prompt' }
    );
    const assertion = expect(pending).rejects.toThrow('model call timed out');
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    await assertion;
  });

  it('keeps the connector deadline active through response-body streaming', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stalledBodyFetch());

    const pending = stripeTest({ api_key: 'rk_test' });
    const assertion = expect(pending).rejects.toThrow('connector request timed out');
    await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS);
    await assertion;
  });

  it('does not reflect provider-controlled error details or headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'sk_must_not_leak' }), {
            status: 401,
            headers: { 'x-request-id': 'sk_must_not_leak' },
          })
      )
    );

    const pending = callModel(
      {
        taskClass: 'narration',
        mode: 'byok',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        effort: 'low',
        baseUrl: '',
      },
      'sk-test',
      { system: 'system', prompt: 'prompt' }
    );
    let caught: unknown;
    try {
      await pending;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('model call failed (401)');
    expect((caught as Error).message).not.toContain('sk_must_not_leak');
  });
});

describe('network address boundaries', () => {
  it('recognizes every supported loopback representation', () => {
    for (const value of [
      'localhost',
      'LOCALHOST.',
      '127.0.0.1',
      '127.255.255.254',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
      '[::ffff:7f00:1]',
    ]) {
      expect(isLoopbackHostname(value), value).toBe(true);
    }
    expect(isLoopbackHostname('128.0.0.1')).toBe(false);
  });

  it('rejects non-public IPv4 and IPv6 literals byte-for-byte', () => {
    for (const value of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '169.254.169.254',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.0.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:7f00:1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '2002::1',
      '3fff::1',
    ]) {
      expect(isNonPublicIpLiteral(value), value).toBe(true);
    }
    expect(isNonPublicIpLiteral('8.8.8.8')).toBe(false);
    expect(isNonPublicIpLiteral('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks local-only names while preserving ordinary public domains', () => {
    for (const value of ['localhost', 'api.localhost', 'service.local', 'service.internal']) {
      expect(isUnsafePublicHostname(value), value).toBe(true);
    }
    expect(isUnsafePublicHostname('fdic.gov')).toBe(false);
  });
});

describe('privacy-safe analytics URLs', () => {
  it('redacts encoded emails and stable user identifiers', () => {
    expect(
      privacySafeUrl('https://app.example/users/jane%40example.com?token=secret#private')
    ).toBe('https://app.example/users/:email');
    expect(privacySafeUrl('https://app.example/users/5b1ac329-63de-4e71-b8c7-bb11696618b0')).toBe(
      'https://app.example/users/:id'
    );
    expect(privacySafeUrl('https://app.example/orders/123456789')).toBe(
      'https://app.example/orders/:id'
    );
  });

  it('never reflects malformed or non-web input', () => {
    expect(privacySafeUrl('jane@example.com/private?token=secret')).toBe(':invalid-url');
    expect(privacySafeUrl('https://app.example/%E0%A4%A')).toBe('https://app.example/:redacted');
    expect(privacySafeUrl('javascript:jane@example.com')).toBe(':invalid-url');
  });
});

describe('outbound connector prerequisites', () => {
  it('requires an exact accessible Linear team', async () => {
    await expect(linearTest({ api_key: 'lin' }, {})).rejects.toThrow(/team key is required/i);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                viewer: { email: 'person@example.com' },
                teams: { nodes: [{ key: 'ENG' }] },
              },
            }),
            { status: 200 }
          )
      )
    );
    await expect(linearTest({ api_key: 'lin' }, { team_key: 'ENG' })).resolves.toMatchObject({
      ok: true,
      detail: expect.stringContaining('team ENG'),
    });
    await expect(linearTest({ api_key: 'lin' }, { team_key: 'OPS' })).rejects.toThrow(
      /not accessible/i
    );
  });

  it('requires the configured Resend sender domain to be verified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { name: 'verified.example', status: 'verified' },
                { name: 'pending.example', status: 'pending' },
              ],
            }),
            { status: 200 }
          )
      )
    );
    await expect(
      resendTest({ from: 'team@verified.example' }, { api_key: 're_test' })
    ).resolves.toEqual({ ok: true, detail: 'verified sender domain verified.example' });
    await expect(
      resendTest({ from: 'team@pending.example' }, { api_key: 're_test' })
    ).rejects.toThrow(/not verified/i);
  });
});
