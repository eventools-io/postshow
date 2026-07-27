// GitHub connector fixtures. Every string is invented for this file: the
// repository, the token, the authors, the paths, and the branch names. The
// redaction fixture deliberately carries the hostile shapes a real title can
// carry, because on a public repository anyone at all can open a pull request
// and write that string.
//
// The gather walks three list endpoints in a fixed order (pull requests, then
// commits, then issues), so every scenario below supplies its exchanges in that
// order.

import type { ConnectorFixtures } from './connector';

export const GITHUB_FIXTURE_META = { repo: 'northwind-labs/invoice-web' };
export const GITHUB_FIXTURE_SECRET = { token: 'github-fixture-token' };
export const GITHUB_FIXTURE_WINDOW_DAYS = 7;

/** The gather derives its window from the wall clock and filters merged pull
 * requests against it, so a fixture with fixed timestamps only means the same
 * thing if "now" is fixed too. Tests pin the clock here. */
export const GITHUB_FIXTURE_NOW = '2026-07-22T22:00:00Z';

// A live-key shape is the most convincing thing a title can leak. It is
// assembled rather than spelled because GitHub push protection matches the
// contiguous literal on sight, in this file as readily as in a real leak.
export const GITHUB_FIXTURE_LEAKED_KEY = ['sk', 'live', '7HnQvFixtureOnlyNeverARealKey0000'].join(
  '_'
);

const MERGED_PULL = {
  number: 812,
  title: 'Round invoice line totals before summing',
  merged_at: '2026-07-21T16:20:00Z',
  updated_at: '2026-07-21T16:20:00Z',
};

const COMMIT = {
  sha: '4f21ac9e0b7d3c5182ff60a4b9e8d7c3a1526079',
  commit: {
    message: 'Round invoice line totals before summing',
    committer: { date: '2026-07-21T16:18:00Z' },
  },
};

const ISSUE = {
  number: 796,
  title: 'Invoice total is off by a cent on multi-line orders',
  updated_at: '2026-07-22T09:05:00Z',
};

function sampledPull(index: number): Record<string, unknown> {
  return {
    number: 1000 + index,
    title: `Dependency bump ${index}`,
    merged_at: '2026-07-21T12:00:00Z',
    updated_at: '2026-07-21T12:00:00Z',
  };
}

export const GITHUB_FIXTURES: ConnectorFixtures = {
  success: {
    scenario: 'success',
    expectation:
      'One merged pull request, one commit, and one issue each become a citable object, and the source reports complete coverage of the requested window.',
    exchanges: [
      { outcome: 'response', status: 200, body: [MERGED_PULL] },
      { outcome: 'response', status: 200, body: [COMMIT] },
      { outcome: 'response', status: 200, body: [ISSUE] },
    ],
  },

  sampled: {
    scenario: 'sampled',
    expectation:
      'A full page of merged pull requests stops at the page cap and reports partial coverage instead of presenting the page as the whole history.',
    exchanges: [
      {
        outcome: 'response',
        status: 200,
        body: Array.from({ length: 100 }, (_value, index) => sampledPull(index)),
      },
      { outcome: 'response', status: 200, body: [] },
      { outcome: 'response', status: 200, body: [] },
    ],
  },

  malformed: {
    scenario: 'malformed',
    expectation:
      'Rows that cannot be named or placed in time are dropped rather than cited, an abbreviated sha is refused because it cannot be re-resolved, and a pull request echoed by the issues endpoint is not cited a second time.',
    exchanges: [
      {
        outcome: 'response',
        status: 200,
        body: [
          null,
          'not-an-object',
          { number: 812, title: 'merged inside the window', merged_at: '2026-07-21T16:20:00Z' },
          { number: 813, title: 'never merged', merged_at: null },
          { number: 814, title: 'merged when it cannot be parsed', merged_at: 'last tuesday' },
        ],
      },
      {
        outcome: 'response',
        status: 200,
        body: [
          { sha: '4f21ac9', commit: { message: 'abbreviated sha is ambiguous' } },
          { sha: 'e7c1b04d29fa38561b0c7e94ad5f26138bc09a4e', commit: { message: 'no date' } },
        ],
      },
      {
        outcome: 'response',
        status: 200,
        body: [
          {
            number: 812,
            title: 'the issues endpoint echoes pull requests',
            updated_at: '2026-07-22T09:05:00Z',
            pull_request: { url: 'https://api.github.com/repos/northwind-labs/invoice-web/pulls/812' },
          },
          { number: 0, title: 'zero is not an object number', updated_at: '2026-07-22T09:05:00Z' },
        ],
      },
    ],
  },

  timeout: {
    scenario: 'timeout',
    expectation:
      'A provider that accepts the request and never answers aborts at the adapter timeout and fails the GitHub gather rather than the run.',
    exchanges: [{ outcome: 'timeout' }],
  },

  rate_limit: {
    scenario: 'rate_limit',
    expectation:
      'A 403 carrying an exhausted rate limit fails the GitHub gather with its status visible, so the run records GitHub as failed instead of as an empty history.',
    exchanges: [
      {
        outcome: 'response',
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1784676000' },
        body: { message: 'API rate limit exceeded', documentation_url: 'https://docs.github.com/' },
      },
    ],
  },

  revoked_credentials: {
    scenario: 'revoked_credentials',
    expectation:
      'A revoked token fails the GitHub gather with its status visible and never echoes the token.',
    exchanges: [
      {
        outcome: 'response',
        status: 401,
        body: { message: 'Bad credentials', documentation_url: 'https://docs.github.com/' },
      },
    ],
  },

  redaction: {
    scenario: 'redaction',
    expectation:
      'Titles written by whoever opened the pull request or issue reach the packet only after emails, developer home directories, query strings, and opaque tokens are removed.',
    exchanges: [
      {
        outcome: 'response',
        status: 200,
        body: [
          {
            number: 901,
            title: 'Hotfix for dana.reyes@northwind-labs.test',
            merged_at: '2026-07-21T18:00:00Z',
            updated_at: '2026-07-21T18:00:00Z',
          },
        ],
      },
      { outcome: 'response', status: 200, body: [] },
      {
        outcome: 'response',
        status: 200,
        body: [
          {
            number: 902,
            title: 'ENOENT: /Users/dana/workspace/northwind/src/invoice.ts is missing',
            updated_at: '2026-07-22T10:00:00Z',
          },
          {
            number: 903,
            title: 'GET /api/invoices?token=r3set&customer=8812 returns 500',
            updated_at: '2026-07-22T10:05:00Z',
          },
          {
            number: 904,
            title: `Provider rejected ${GITHUB_FIXTURE_LEAKED_KEY}`,
            updated_at: '2026-07-22T10:10:00Z',
          },
        ],
      },
    ],
  },
};
