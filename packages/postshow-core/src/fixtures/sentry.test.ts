import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADAPTER_TIMEOUT_MS, packetSections, sentryGather } from '../adapters';
import { CONNECTOR_FIXTURE_SCENARIOS, type ConnectorFixture } from './connector';
import {
  SENTRY_FIXTURES,
  SENTRY_FIXTURE_LEAKED_KEY,
  SENTRY_FIXTURE_META,
  SENTRY_FIXTURE_SECRET,
  SENTRY_FIXTURE_WINDOW_DAYS,
} from './sentry';

/** Replays a fixture's exchanges in order. A timeout exchange honors the
 * caller's abort signal so the real adapter deadline is what ends the request,
 * not a shortcut in the test. */
function replay(fixture: ConnectorFixture): void {
  const remaining = [...fixture.exchanges];
  vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
    const exchange = remaining.shift();
    if (!exchange) throw new Error(`fixture ${fixture.scenario} ran out of provider exchanges`);
    if (exchange.outcome === 'timeout') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(
      new Response(JSON.stringify(exchange.body), {
        status: exchange.status,
        headers: { 'content-type': 'application/json', ...exchange.headers },
      })
    );
  });
}

function gather(options: { maxPages?: number } = {}) {
  return sentryGather(
    SENTRY_FIXTURE_META,
    SENTRY_FIXTURE_SECRET,
    SENTRY_FIXTURE_WINDOW_DAYS,
    options
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sentry connector fixtures', () => {
  it('declares every scenario the connector contract requires', () => {
    expect(Object.keys(SENTRY_FIXTURES).toSorted()).toEqual(
      [...CONNECTOR_FIXTURE_SCENARIOS].toSorted()
    );
    for (const scenario of CONNECTOR_FIXTURE_SCENARIOS) {
      expect(SENTRY_FIXTURES[scenario].scenario).toBe(scenario);
      expect(SENTRY_FIXTURES[scenario].exchanges.length).toBeGreaterThan(0);
    }
  });

  it('turns a successful page into citable references bound to the collection window', async () => {
    replay(SENTRY_FIXTURES.success);

    const result = await gather();

    expect(result.completeness).toMatchObject({ complete: true, returned: 2, available: 2 });
    expect(result.window.days).toBe(SENTRY_FIXTURE_WINDOW_DAYS);
    expect(Date.parse(result.window.until) - Date.parse(result.window.since)).toBe(
      SENTRY_FIXTURE_WINDOW_DAYS * 86400_000
    );
    expect(result.data[0]).toEqual({
      id: '4001',
      title: 'TypeError: cannot read property total of undefined',
      count: 124,
      permalink: 'https://acme.sentry.io/issues/4001/',
      firstSeen: '2026-07-19T04:10:00.000Z',
      lastSeen: '2026-07-22T18:42:00.000Z',
    });
  });

  it('asks Sentry for the run window instead of a fixed period', async () => {
    replay(SENTRY_FIXTURES.success);

    await gather();

    const requested = new URL(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]));
    expect(requested.searchParams.get('query')).toBe(
      `is:unresolved lastSeen:-${SENTRY_FIXTURE_WINDOW_DAYS}d`
    );
    expect(requested.searchParams.get('statsPeriod')).toBe('');
  });

  it('reports a capped page as partial coverage rather than the whole source', async () => {
    replay(SENTRY_FIXTURES.sampled);

    const result = await gather({ maxPages: 1 });

    expect(result.data).toHaveLength(100);
    expect(result.completeness).toMatchObject({ complete: false, returned: 100, available: null });
    expect(result.completeness.reason).toContain('100-record safety cap');
  });

  it('drops rows that cannot become a reference and says how many', async () => {
    replay(SENTRY_FIXTURES.malformed);

    const result = await gather();

    expect(result.data.map((issue) => issue.id)).toEqual(['4103', '4104']);
    expect(result.completeness.complete).toBe(false);
    expect(result.completeness.reason).toBe(
      '5 issue row(s) had no usable provider identifier or timestamps'
    );
    expect(result.data[1]?.permalink).toBe('');
  });

  it('ends a hung request at the adapter deadline', async () => {
    replay(SENTRY_FIXTURES.timeout);
    vi.useFakeTimers();

    const pending = expect(gather()).rejects.toThrow('connector request timed out');
    await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS);
    await pending;
  });

  it('fails the gather on a rate limit instead of returning an empty error list', async () => {
    replay(SENTRY_FIXTURES.rate_limit);

    await expect(gather()).rejects.toThrow('sentry issues failed (429)');
  });

  it('fails the gather on a revoked token without echoing the token', async () => {
    replay(SENTRY_FIXTURES.revoked_credentials);

    await expect(gather()).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(SENTRY_FIXTURE_SECRET.token) as string,
      })
    );
    replay(SENTRY_FIXTURES.revoked_credentials);
    await expect(gather()).rejects.toThrow('sentry issues failed (401)');
  });

  it('redacts provider-authored titles before they reach the packet', async () => {
    replay(SENTRY_FIXTURES.redaction);

    const result = await gather();
    const packet = packetSections({
      posthog: null,
      stripe: null,
      sentry: result,
      github: null,
    }).join('\n');

    expect(result.data.map((issue) => issue.title)).toEqual([
      'CheckoutError: charge failed for :email',
      'ENOENT: no such file /Users/:user/workspace/northwind/src/invoice.ts',
      'HTTPError 500 on GET /api/invoices?:redacted',
      'AuthError: provider rejected :id',
    ]);
    for (const secret of [
      'dana.reyes@northwind-labs.test',
      '/Users/dana',
      'token=r3set',
      'customer=8812',
      SENTRY_FIXTURE_LEAKED_KEY,
    ]) {
      expect(packet).not.toContain(secret);
    }
    expect(packet).toContain('[sentry_issue_id=4201]');
  });
});
