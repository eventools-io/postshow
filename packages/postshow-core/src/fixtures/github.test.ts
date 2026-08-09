import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTER_TIMEOUT_MS, githubGather, packetSections } from '../adapters';
import { CONNECTOR_FIXTURE_SCENARIOS, type ConnectorFixture } from './connector';
import {
  GITHUB_FIXTURES,
  GITHUB_FIXTURE_LEAKED_KEY,
  GITHUB_FIXTURE_META,
  GITHUB_FIXTURE_NOW,
  GITHUB_FIXTURE_SECRET,
  GITHUB_FIXTURE_WINDOW_DAYS,
} from './github';

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
  return githubGather(
    GITHUB_FIXTURE_META,
    GITHUB_FIXTURE_SECRET,
    GITHUB_FIXTURE_WINDOW_DAYS,
    options
  );
}

function refs(objects: { type: string; id: string }[]): string[] {
  return objects.map((object) => `${object.type}:${object.id}`);
}

beforeEach(() => {
  // The fixture timestamps only sit inside the collection window if "now" is
  // the moment the fixtures were written for, so the clock is pinned for every
  // scenario rather than only the one that advances it.
  vi.useFakeTimers({ now: new Date(GITHUB_FIXTURE_NOW) });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('github connector fixtures', () => {
  it('declares every scenario the connector contract requires', () => {
    expect(Object.keys(GITHUB_FIXTURES).toSorted()).toEqual(
      [...CONNECTOR_FIXTURE_SCENARIOS].toSorted()
    );
    for (const scenario of CONNECTOR_FIXTURE_SCENARIOS) {
      expect(GITHUB_FIXTURES[scenario].scenario).toBe(scenario);
      expect(GITHUB_FIXTURES[scenario].exchanges.length).toBeGreaterThan(0);
    }
  });

  it('turns a successful collection into citable objects bound to the window', async () => {
    replay(GITHUB_FIXTURES.success);

    const result = await gather();

    expect(result.repo).toBe(GITHUB_FIXTURE_META.repo);
    // Three, matching the three citable objects asserted below, not the one
    // merged pull request among them. The gateway reads this count to decide
    // whether the run supplied code context at all.
    expect(result.completeness).toMatchObject({ complete: true, returned: 3 });
    expect(result.window.days).toBe(GITHUB_FIXTURE_WINDOW_DAYS);
    expect(Date.parse(result.window.until) - Date.parse(result.window.since)).toBe(
      GITHUB_FIXTURE_WINDOW_DAYS * 86400_000
    );
    expect(refs(result.objects)).toEqual([
      'pull_request:812',
      'commit:4f21ac9e0b7d3c5182ff60a4b9e8d7c3a1526079',
      'issue:796',
    ]);
    expect(result.objects[0]?.url).toBe(`https://github.com/${GITHUB_FIXTURE_META.repo}/pull/812`);
    expect(result.objects[1]?.url).toBe(
      `https://github.com/${GITHUB_FIXTURE_META.repo}/commit/4f21ac9e0b7d3c5182ff60a4b9e8d7c3a1526079`
    );
    expect(result.objects[2]?.url).toBe(
      `https://github.com/${GITHUB_FIXTURE_META.repo}/issues/796`
    );
  });

  it('asks GitHub for the run window instead of a fixed period', async () => {
    replay(GITHUB_FIXTURES.success);

    const result = await gather();

    const commitRequest = new URL(String(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]));
    expect(commitRequest.searchParams.get('since')).toBe(result.window.since);
    expect(commitRequest.searchParams.get('until')).toBe(result.window.until);
    const issueRequest = new URL(String(vi.mocked(globalThis.fetch).mock.calls[2]?.[0]));
    expect(issueRequest.searchParams.get('since')).toBe(result.window.since);
  });

  it('reports a capped page as partial coverage rather than the whole history', async () => {
    replay(GITHUB_FIXTURES.sampled);

    const result = await gather({ maxPages: 1 });

    expect(result.data).toHaveLength(100);
    expect(result.completeness).toMatchObject({ complete: false, returned: 100, available: null });
    expect(result.completeness.reason).toContain('pull requests exceeded');
  });

  it('drops rows that cannot become a reference and never cites one object twice', async () => {
    replay(GITHUB_FIXTURES.malformed);

    const result = await gather();

    // The abbreviated sha, the dateless commit, the unmerged and unparseable
    // pulls, issue 0, and the pull echoed by the issues endpoint all fail to
    // become references, leaving the one object that can be named and placed.
    expect(refs(result.objects)).toEqual(['pull_request:812']);
  });

  it('ends a hung request at the adapter deadline', async () => {
    replay(GITHUB_FIXTURES.timeout);

    const pending = expect(gather()).rejects.toThrow('connector request timed out');
    await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS);
    await pending;
  });

  it('fails the gather on a rate limit instead of returning an empty history', async () => {
    replay(GITHUB_FIXTURES.rate_limit);

    await expect(gather()).rejects.toThrow('github pull requests failed (403)');
  });

  it('fails the gather on a revoked token without echoing the token', async () => {
    replay(GITHUB_FIXTURES.revoked_credentials);

    await expect(gather()).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(GITHUB_FIXTURE_SECRET.token) as string,
      })
    );
    replay(GITHUB_FIXTURES.revoked_credentials);
    await expect(gather()).rejects.toThrow('github pull requests failed (401)');
  });

  it('redacts provider-authored titles before they reach the packet', async () => {
    replay(GITHUB_FIXTURES.redaction);

    const result = await gather();
    const packet = packetSections({
      posthog: null,
      stripe: null,
      sentry: null,
      github: result,
    }).join('\n');

    expect(result.objects.map((object) => object.title)).toEqual([
      'Hotfix for :email',
      'ENOENT: /Users/:user/workspace/northwind/src/invoice.ts is missing',
      'GET /api/invoices?:redacted returns 500',
      'Provider rejected :id',
    ]);
    for (const secret of [
      'dana.reyes@northwind-labs.test',
      '/Users/dana',
      'token=r3set',
      'customer=8812',
      GITHUB_FIXTURE_LEAKED_KEY,
    ]) {
      expect(packet).not.toContain(secret);
    }
    expect(packet).toContain('[github_object=pull_request:901]');
  });
});
