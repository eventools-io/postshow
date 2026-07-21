import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_TIMEOUT_MS, GatewayError, gateway, resolveGatewayEndpoint } from './api';

const config = { apiUrl: 'https://example.test', token: 'psh_test_token' };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('gateway', () => {
  it('uses a non-following request and returns bounded JSON', async () => {
    const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ ok: true, value: 7 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);

    await expect(gateway<{ value: number }>(config, 'test.op')).resolves.toMatchObject({
      value: 7,
    });
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('aborts a gateway request at the deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')));
          })
      )
    );

    const pending = gateway(config, 'test.op');
    const assertion = expect(pending).rejects.toMatchObject({
      message: 'gateway request timed out',
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(GATEWAY_TIMEOUT_MS);
    await assertion;
  });

  it('keeps the deadline active while the response body is streaming', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
          },
        });
        return new Response(stream, { status: 200 });
      })
    );

    const pending = gateway(config, 'test.op');
    const assertion = expect(pending).rejects.toMatchObject({
      message: 'gateway request timed out',
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(GATEWAY_TIMEOUT_MS);
    await assertion;
  });

  it('never reflects an upstream error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, detail: 'psh_must_not_leak' }), {
            status: 401,
            headers: { 'x-request-id': 'psh_must_not_leak' },
          })
      )
    );

    let caught: unknown;
    try {
      await gateway(config, 'test.op');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    expect((caught as Error).message).toBe('gateway request failed (401)');
    expect((caught as Error).message).not.toContain('psh_must_not_leak');
  });

  it.each([
    ['an empty body', ''],
    ['an empty object', '{}'],
    ['a missing ok field', JSON.stringify({ value: 7 })],
    ['ok false', JSON.stringify({ ok: false })],
    ['a string ok field', JSON.stringify({ ok: 'true' })],
    ['a numeric ok field', JSON.stringify({ ok: 1 })],
    ['a truncated object', '{"ok":'],
    ['an array', JSON.stringify([{ ok: true }])],
    ['a primitive', 'true'],
  ])('rejects a successful response containing %s', async (_label, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 }))
    );

    await expect(gateway(config, 'test.op')).rejects.toMatchObject({ status: 502 });
  });

  it('rejects redirects and oversized bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302 }))
    );
    await expect(gateway(config, 'test.op')).rejects.toMatchObject({
      message: 'gateway redirects are not allowed',
      status: 302,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } })
      )
    );
    await expect(gateway(config, 'test.op')).rejects.toMatchObject({
      message: 'gateway response exceeded the 2 MiB safety limit',
      status: 502,
    });
  });

  it('never sends a token to an unsafe or credential-bearing gateway URL', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);

    const unsafeUrls = [
      'http://gateway.example',
      'https://10.0.0.2',
      'https://198.18.0.1',
      'https://192.0.0.1',
      'https://224.0.0.1',
      'https://[::]',
      'https://[ff02::1]',
      'https://[2001:db8::1]',
      'https://[::ffff:127.0.0.1]',
      'https://user:psh_must_not_leak@gateway.example',
      'https://gateway.example?token=psh_must_not_leak',
      'https://gateway.example/base-path',
    ];
    for (const apiUrl of unsafeUrls) {
      let caught: unknown;
      try {
        await gateway({ apiUrl, token: 'psh_test_token' }, 'test.op');
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ status: 400 });
      expect((caught as Error).message).not.toContain('psh_must_not_leak');
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('allows an exact loopback HTTP origin for local development', () => {
    expect(resolveGatewayEndpoint('http://127.0.0.1:54321')).toBe(
      'http://127.0.0.1:54321/functions/v1/postshow-api'
    );
    expect(resolveGatewayEndpoint('http://localhost:54321')).toBe(
      'http://localhost:54321/functions/v1/postshow-api'
    );
    expect(resolveGatewayEndpoint('https://fdic.gov')).toBe(
      'https://fdic.gov/functions/v1/postshow-api'
    );
    expect(resolveGatewayEndpoint('https://8.8.8.8')).toBe(
      'https://8.8.8.8/functions/v1/postshow-api'
    );
    expect(resolveGatewayEndpoint('https://[2606:4700:4700::1111]')).toBe(
      'https://[2606:4700:4700::1111]/functions/v1/postshow-api'
    );
  });
});
