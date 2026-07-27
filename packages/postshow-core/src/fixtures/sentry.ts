// Sentry connector fixtures. Every string is invented for this file: the
// organization, the project, the token, the customer names, and the paths.
// The redaction fixture deliberately carries the hostile shapes a real issue
// title can carry, because anyone who can throw an exception inside the
// customer's product writes that string.

import type { ConnectorFixtures } from './connector';

export const SENTRY_FIXTURE_META = { org_slug: 'acme', project_slug: 'web' };
export const SENTRY_FIXTURE_SECRET = { token: 'sentry-fixture-token' };
export const SENTRY_FIXTURE_WINDOW_DAYS = 7;

// A live-key shape is the most convincing thing an exception title can leak, so
// the redaction fixture carries one. It is assembled rather than spelled
// because GitHub push protection matches the contiguous literal on sight, in
// this file as readily as in a real leak. The sanitizer only ever sees the
// joined value, which is what `SENTRY_OPAQUE_TOKEN` is tested against.
export const SENTRY_FIXTURE_LEAKED_KEY = ['sk', 'live', '51QbXmpFixtureOnlyNeverRealKey00'].join(
  '_'
);

const NEXT_PAGE_LINK =
  '<https://sentry.io/api/0/projects/acme/web/issues/?cursor=fixture-page-two>; rel="next"; results="true"';

function sampledIssue(index: number): Record<string, unknown> {
  return {
    id: String(5000 + index),
    title: `ValidationError: invoice line ${index} rejected`,
    culprit: 'billing in renderInvoice',
    count: String(100 - index),
    permalink: `https://acme.sentry.io/issues/${5000 + index}/`,
    firstSeen: '2026-07-18T09:00:00Z',
    lastSeen: '2026-07-22T11:30:00Z',
  };
}

export const SENTRY_FIXTURES: ConnectorFixtures = {
  success: {
    scenario: 'success',
    expectation:
      'Both unresolved issues become citable references, and the source reports complete coverage of the requested window.',
    exchanges: [
      {
        outcome: 'response',
        status: 200,
        body: [
          {
            id: '4001',
            title: 'TypeError: cannot read property total of undefined',
            culprit: 'checkout in submitOrder',
            count: '124',
            permalink: 'https://acme.sentry.io/issues/4001/',
            firstSeen: '2026-07-19T04:10:00Z',
            lastSeen: '2026-07-22T18:42:00Z',
          },
          {
            id: '4002',
            title: 'TimeoutError: invoice render exceeded the request budget',
            culprit: 'billing in renderInvoice',
            count: '31',
            permalink: 'https://acme.sentry.io/issues/4002/',
            firstSeen: '2026-07-21T13:05:00Z',
            lastSeen: '2026-07-22T17:58:00Z',
          },
        ],
      },
    ],
  },

  sampled: {
    scenario: 'sampled',
    expectation:
      'A full page with another cursor stops at the page cap and reports partial coverage instead of presenting the page as the whole source.',
    exchanges: [
      {
        outcome: 'response',
        status: 200,
        headers: { link: NEXT_PAGE_LINK },
        body: Array.from({ length: 100 }, (_value, index) => sampledIssue(index)),
      },
    ],
  },

  malformed: {
    scenario: 'malformed',
    expectation:
      'Rows that cannot be named or placed in time are dropped and counted as partial coverage; a hostile permalink costs the issue its link, not its reference.',
    exchanges: [
      {
        outcome: 'response',
        status: 200,
        body: [
          null,
          'not-an-object',
          {
            id: 'ACME-WEB-7',
            title: 'a short id is not the provider reference',
            count: '2',
            firstSeen: '2026-07-20T00:00:00Z',
            lastSeen: '2026-07-22T00:00:00Z',
          },
          { id: '4101', title: 'no timestamps at all', count: '9' },
          {
            id: '4102',
            title: 'timestamps that do not parse',
            count: '4',
            firstSeen: 'yesterday',
            lastSeen: 'today',
          },
          {
            id: '4103',
            title: 'ReferenceError: usable row survives the malformed page',
            count: '7',
            permalink: 'https://acme.sentry.io/issues/4103/',
            firstSeen: '2026-07-20T06:00:00Z',
            lastSeen: '2026-07-22T19:15:00Z',
          },
          {
            id: '4104',
            title: 'RangeError: permalink points off Sentry',
            count: '1',
            permalink: 'https://evil.example/issues/4104/',
            firstSeen: '2026-07-21T06:00:00Z',
            lastSeen: '2026-07-22T20:00:00Z',
          },
        ],
      },
    ],
  },

  timeout: {
    scenario: 'timeout',
    expectation:
      'A provider that accepts the request and never answers aborts at the adapter timeout and fails the Sentry gather rather than the run.',
    exchanges: [{ outcome: 'timeout' }],
  },

  rate_limit: {
    scenario: 'rate_limit',
    expectation:
      'A 429 fails the Sentry gather with its status visible, so the run records Sentry as failed instead of as an empty error list.',
    exchanges: [
      {
        outcome: 'response',
        status: 429,
        headers: {
          'retry-after': '60',
          'x-sentry-rate-limit-remaining': '0',
        },
        body: { detail: 'You are attempting to use this endpoint too frequently.' },
      },
    ],
  },

  revoked_credentials: {
    scenario: 'revoked_credentials',
    expectation:
      'A revoked token fails the Sentry gather with its status visible and never leaks the token into the error.',
    exchanges: [
      {
        outcome: 'response',
        status: 401,
        body: { detail: 'Invalid token' },
      },
    ],
  },

  redaction: {
    scenario: 'redaction',
    expectation:
      'Provider-authored titles reach the packet only after emails, developer home directories, query strings, and opaque tokens are removed.',
    exchanges: [
      {
        outcome: 'response',
        status: 200,
        body: [
          {
            id: '4201',
            title: 'CheckoutError: charge failed for dana.reyes@northwind-labs.test',
            count: '12',
            permalink: 'https://acme.sentry.io/issues/4201/',
            firstSeen: '2026-07-20T08:00:00Z',
            lastSeen: '2026-07-22T21:00:00Z',
          },
          {
            id: '4202',
            title: 'ENOENT: no such file /Users/dana/workspace/northwind/src/invoice.ts',
            count: '8',
            permalink: 'https://acme.sentry.io/issues/4202/',
            firstSeen: '2026-07-20T09:00:00Z',
            lastSeen: '2026-07-22T21:05:00Z',
          },
          {
            id: '4203',
            title: 'HTTPError 500 on GET /api/invoices?token=r3set&customer=8812',
            count: '5',
            permalink: 'https://acme.sentry.io/issues/4203/',
            firstSeen: '2026-07-20T10:00:00Z',
            lastSeen: '2026-07-22T21:10:00Z',
          },
          {
            id: '4204',
            title: `AuthError: provider rejected ${SENTRY_FIXTURE_LEAKED_KEY}`,
            count: '3',
            permalink: 'https://acme.sentry.io/issues/4204/',
            firstSeen: '2026-07-20T11:00:00Z',
            lastSeen: '2026-07-22T21:15:00Z',
          },
        ],
      },
    ],
  },
};
