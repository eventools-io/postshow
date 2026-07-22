import { describe, expect, it } from 'vitest';
import type { GatherResult, PosthogGather, StripeAccount } from './adapters';
import { sourceIdentityContext, stripeSourceAccounts } from './identity';

function stripeResult(data: StripeAccount[]): GatherResult<StripeAccount[]> {
  return {
    data,
    completeness: { complete: true, sampled: false, returned: data.length, available: data.length },
  };
}

const stripe = stripeResult([
  {
    customerId: 'cus_123',
    subscriptionId: 'sub_123',
    name: 'Acme',
    email: ' Owner@Example.Test ',
    status: 'active',
    mrrCents: 9900,
    currency: 'USD',
  },
]);

const posthog: PosthogGather = {
  topline: { sessions: 1, users: 1, pageviews: 2 },
  ragePages: [],
  samples: [
    {
      sid: 'session-123',
      email: 'owner@example.test',
      distinctId: 'person-123',
      started: '2026-07-22T00:00:00Z',
      seconds: 20,
      events: 2,
      firstEvents: ['$pageview'],
      rages: 1,
      errors: 0,
    },
  ],
  completeness: { complete: true, sampled: false, returned: 1, available: 1 },
};

describe('source identity context', () => {
  it('normalizes stable Stripe snapshots', () => {
    expect(stripeSourceAccounts(stripe)).toEqual([
      expect.objectContaining({
        identityKey: 'stripe:cus_123',
        mrrCents: 9900,
        externalIds: expect.objectContaining({ email: 'owner@example.test' }),
      }),
    ]);
  });

  it('aggregates multiple subscriptions for one customer without overwriting revenue', () => {
    const result = stripeSourceAccounts(
      stripeResult([
        stripe.data[0]!,
        { ...stripe.data[0]!, subscriptionId: 'sub_456', mrrCents: 5100 },
      ])
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mrrCents: 15000,
      currency: 'USD',
      externalIds: { stripe_subscription_ids: ['sub_123', 'sub_456'] },
    });
  });

  it('joins an exact replay to one account through an unambiguous normalized email', () => {
    const context = sourceIdentityContext(posthog, stripe);
    expect(context.links).toEqual([
      expect.objectContaining({ provider: 'stripe', identityType: 'customer_id', confidence: 1 }),
      expect.objectContaining({
        provider: 'posthog',
        identityType: 'distinct_id',
        externalId: 'person-123',
        confidence: 0.95,
      }),
      expect.objectContaining({ provider: 'email', externalId: 'owner@example.test' }),
      expect.objectContaining({
        provider: 'stripe',
        identityType: 'subscription_id',
        confidence: 1,
      }),
    ]);
    expect(context.sessions).toEqual([
      {
        sessionId: 'session-123',
        accountIdentityKey: 'stripe:cus_123',
        posthogDistinctId: 'person-123',
        confidence: 0.95,
      },
    ]);
    expect(context.completeness).toMatchObject({ complete: true, matchedSessions: 1 });
  });

  it('leaves shared billing emails unattributed', () => {
    const shared = stripeResult([
      stripe.data[0]!,
      { ...stripe.data[0]!, customerId: 'cus_456', subscriptionId: 'sub_456', name: 'Beta' },
    ]);
    const context = sourceIdentityContext(posthog, shared);
    expect(context.links.some((link) => link.provider === 'posthog')).toBe(false);
    expect(context.sessions).toEqual([]);
    expect(context.completeness).toMatchObject({ complete: false, ambiguousEmails: 1 });
  });

  it('leaves a PostHog distinct id unattributed when it points at two accounts', () => {
    const twoAccounts = stripeResult([
      stripe.data[0]!,
      {
        ...stripe.data[0]!,
        customerId: 'cus_456',
        subscriptionId: 'sub_456',
        name: 'Beta',
        email: 'beta@example.test',
      },
    ]);
    const context = sourceIdentityContext(
      {
        ...posthog,
        samples: [
          posthog.samples[0]!,
          { ...posthog.samples[0]!, sid: 'session-456', email: 'beta@example.test' },
        ],
      },
      twoAccounts
    );
    expect(context.links.some((link) => link.provider === 'posthog')).toBe(false);
    expect(context.sessions).toEqual([]);
    expect(context.completeness).toMatchObject({
      complete: false,
      conflictingDistinctIds: 1,
      unmatchedSessions: 2,
    });
  });

  it('reports account groups beyond the bounded identity-map cap', () => {
    const accounts = Array.from({ length: 201 }, (_, index) => ({
      ...stripe.data[0]!,
      customerId: `cus_${index}`,
      subscriptionId: `sub_${index}`,
      email: `owner-${index}@example.test`,
    }));
    const context = sourceIdentityContext(null, stripeResult(accounts));
    expect(stripeSourceAccounts(stripeResult(accounts))).toHaveLength(200);
    expect(context.completeness).toMatchObject({
      complete: false,
      truncatedAccountGroups: 1,
    });
  });

  it('bounds identity links without dropping customer or replay identities', () => {
    const subscriptions = Array.from({ length: 1_050 }, (_, index) => ({
      ...stripe.data[0]!,
      subscriptionId: `sub_${String(index).padStart(4, '0')}`,
    }));
    const context = sourceIdentityContext(posthog, stripeResult(subscriptions));
    expect(context.links).toHaveLength(1_000);
    expect(context.links[0]).toMatchObject({ identityType: 'customer_id' });
    expect(context.links.some((link) => link.identityType === 'distinct_id')).toBe(true);
    expect(context.completeness).toMatchObject({
      complete: false,
      omittedIdentityLinks: 53,
    });
  });
});
