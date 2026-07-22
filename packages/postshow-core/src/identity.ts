import type { GatherResult, PosthogGather, StripeAccount } from './adapters';
import { canonicalSessionId } from './sanitize';

export interface SourceAccountSnapshot {
  identityKey: string;
  name: string;
  externalIds: Record<string, string | string[]>;
  status: string;
  statusTone: 'bad' | 'good';
  mrrCents: number | null;
  currency: string;
  mrrByCurrency: Record<string, number>;
}

export interface SourceIdentityLink {
  accountIdentityKey: string;
  provider: 'email' | 'posthog' | 'stripe';
  identityType: 'customer_id' | 'distinct_id' | 'email' | 'subscription_id';
  externalId: string;
  confidence: number;
}

export interface SourceSessionLink {
  sessionId: string;
  accountIdentityKey: string;
  posthogDistinctId: string;
  confidence: number;
}

export interface SourceIdentityContext {
  links: SourceIdentityLink[];
  sessions: SourceSessionLink[];
  completeness: {
    complete: boolean;
    sampled: boolean;
    matchedSessions: number;
    unmatchedSessions: number;
    ambiguousEmails: number;
    conflictingDistinctIds: number;
    truncatedAccountGroups: number;
    rejectedSourceIds: number;
    omittedIdentityLinks: number;
    reasons: string[];
  };
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function exactSourceId(value: string): string {
  const hasControl = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  return value.length > 0 && value.length <= 240 && !hasControl ? value : '';
}

interface AccountGroup {
  customerId: string;
  name: string;
  emails: Set<string>;
  subscriptions: StripeAccount[];
}

interface AccountGroups {
  groups: AccountGroup[];
  rejectedSourceIds: number;
  truncatedAccountGroups: number;
}

function stripeAccountGroups(stripe: GatherResult<StripeAccount[]> | null): AccountGroups {
  const groups = new Map<string, AccountGroup>();
  let rejectedSourceIds = 0;
  for (const account of stripe?.data ?? []) {
    const customerId = exactSourceId(account.customerId);
    const subscriptionId = exactSourceId(account.subscriptionId);
    if (!customerId || !subscriptionId) {
      rejectedSourceIds += 1;
      continue;
    }
    const group = groups.get(customerId) ?? {
      customerId,
      name: account.name,
      emails: new Set<string>(),
      subscriptions: [],
    };
    const email = normalizedEmail(account.email);
    if (email) group.emails.add(email);
    group.subscriptions.push({ ...account, customerId, subscriptionId });
    groups.set(customerId, group);
  }
  const allGroups = [...groups.values()];
  return {
    groups: allGroups.slice(0, 200),
    rejectedSourceIds,
    truncatedAccountGroups: Math.max(0, allGroups.length - 200),
  };
}

/** Stable source-owned account snapshots. Model output never creates these identifiers. */
export function stripeSourceAccounts(
  stripe: GatherResult<StripeAccount[]> | null
): SourceAccountSnapshot[] {
  return stripeAccountGroups(stripe).groups.map((group) => {
    const mrrByCurrency: Record<string, number> = {};
    for (const subscription of group.subscriptions) {
      const currency = subscription.currency.toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) continue;
      mrrByCurrency[currency] = (mrrByCurrency[currency] ?? 0) + subscription.mrrCents;
    }
    const currencies = Object.keys(mrrByCurrency).sort();
    const subscriptionIds = group.subscriptions.map((row) => row.subscriptionId);
    const email = group.emails.size === 1 ? [...group.emails][0] : undefined;
    return {
      identityKey: `stripe:${group.customerId}`,
      name: group.name,
      externalIds: {
        stripe_customer_id: group.customerId,
        stripe_subscription_ids: subscriptionIds,
        ...(subscriptionIds.length === 1 ? { stripe_subscription_id: subscriptionIds[0]! } : {}),
        ...(email ? { email } : {}),
      },
      status: group.subscriptions.some((row) => row.status === 'past_due')
        ? 'past_due'
        : (group.subscriptions[0]?.status ?? 'active'),
      statusTone: group.subscriptions.some((row) => row.status === 'past_due') ? 'bad' : 'good',
      mrrCents: currencies.length === 1 ? mrrByCurrency[currencies[0]!]! : null,
      currency: currencies.length === 1 ? currencies[0]! : '',
      mrrByCurrency,
    };
  });
}

interface CandidateSession extends SourceSessionLink {
  distinctId: string;
}

/** Identity-map v1 joins source-owned Stripe accounts to PostHog sessions by
 * normalized email only when both the email and PostHog distinct id resolve
 * to exactly one account. Conflicting evidence is preserved as completeness
 * metadata and never promoted to a confident link. */
export function sourceIdentityContext(
  posthog: PosthogGather | null,
  stripe: GatherResult<StripeAccount[]> | null
): SourceIdentityContext {
  const grouped = stripeAccountGroups(stripe);
  const accountsByEmail = new Map<string, Set<string>>();
  const links: SourceIdentityLink[] = [];
  for (const group of grouped.groups) {
    const accountIdentityKey = `stripe:${group.customerId}`;
    links.push({
      accountIdentityKey,
      provider: 'stripe',
      identityType: 'customer_id',
      externalId: group.customerId,
      confidence: 1,
    });
    for (const subscription of group.subscriptions) {
      links.push({
        accountIdentityKey,
        provider: 'stripe',
        identityType: 'subscription_id',
        externalId: subscription.subscriptionId,
        confidence: 1,
      });
    }
    for (const email of group.emails) {
      const identities = accountsByEmail.get(email) ?? new Set<string>();
      identities.add(accountIdentityKey);
      accountsByEmail.set(email, identities);
    }
  }

  const ambiguousEmails = [...accountsByEmail.values()].filter((ids) => ids.size > 1).length;
  for (const [email, accounts] of accountsByEmail) {
    if (accounts.size !== 1) continue;
    links.push({
      accountIdentityKey: [...accounts][0]!,
      provider: 'email',
      identityType: 'email',
      externalId: email,
      confidence: 1,
    });
  }

  const candidates: CandidateSession[] = [];
  const accountsByDistinctId = new Map<string, Set<string>>();
  let unmatchedSessions = 0;
  for (const sample of posthog?.samples ?? []) {
    const sessionId = canonicalSessionId(sample.sid);
    const email = normalizedEmail(sample.email);
    const distinctId = exactSourceId(sample.distinctId);
    const accounts = email ? accountsByEmail.get(email) : undefined;
    if (!sessionId || !distinctId || accounts?.size !== 1) {
      unmatchedSessions += 1;
      continue;
    }
    const accountIdentityKey = [...accounts][0]!;
    const distinctAccounts = accountsByDistinctId.get(distinctId) ?? new Set<string>();
    distinctAccounts.add(accountIdentityKey);
    accountsByDistinctId.set(distinctId, distinctAccounts);
    candidates.push({
      sessionId,
      accountIdentityKey,
      posthogDistinctId: distinctId,
      distinctId,
      confidence: 0.95,
    });
  }

  const sessions: SourceSessionLink[] = [];
  const posthogIdentities = new Set<string>();
  for (const candidate of candidates) {
    if (accountsByDistinctId.get(candidate.distinctId)?.size !== 1) {
      unmatchedSessions += 1;
      continue;
    }
    if (!posthogIdentities.has(candidate.distinctId)) {
      links.push({
        accountIdentityKey: candidate.accountIdentityKey,
        provider: 'posthog',
        identityType: 'distinct_id',
        externalId: candidate.distinctId,
        confidence: 0.95,
      });
      posthogIdentities.add(candidate.distinctId);
    }
    sessions.push({
      sessionId: candidate.sessionId,
      accountIdentityKey: candidate.accountIdentityKey,
      posthogDistinctId: candidate.posthogDistinctId,
      confidence: candidate.confidence,
    });
  }

  const conflictingDistinctIds = [...accountsByDistinctId.values()].filter(
    (accounts) => accounts.size > 1
  ).length;
  const linkPriority: Record<SourceIdentityLink['identityType'], number> = {
    customer_id: 0,
    distinct_id: 1,
    email: 2,
    subscription_id: 3,
  };
  const orderedLinks = links.toSorted(
    (left, right) =>
      linkPriority[left.identityType] - linkPriority[right.identityType] ||
      left.accountIdentityKey.localeCompare(right.accountIdentityKey) ||
      left.externalId.localeCompare(right.externalId)
  );
  const boundedLinks = orderedLinks.slice(0, 1000);
  const omittedIdentityLinks = orderedLinks.length - boundedLinks.length;
  const reasons = [
    ...(posthog && !posthog.completeness.complete
      ? ['PostHog coverage is sampled or partial.']
      : []),
    ...(stripe && !stripe.completeness.complete ? ['Stripe coverage is sampled or partial.'] : []),
    ...(ambiguousEmails > 0
      ? [`${ambiguousEmails} shared email mapping(s) were left unattributed.`]
      : []),
    ...(conflictingDistinctIds > 0
      ? [
          `${conflictingDistinctIds} conflicting PostHog identity mapping(s) were left unattributed.`,
        ]
      : []),
    ...(unmatchedSessions > 0
      ? [`${unmatchedSessions} session(s) could not be attributed to one account.`]
      : []),
    ...(grouped.truncatedAccountGroups > 0
      ? [`${grouped.truncatedAccountGroups} account group(s) exceeded the identity-map cap.`]
      : []),
    ...(grouped.rejectedSourceIds > 0
      ? [`${grouped.rejectedSourceIds} source row(s) had invalid identifiers.`]
      : []),
    ...(omittedIdentityLinks > 0
      ? [`${omittedIdentityLinks} lower-priority identity link(s) exceeded the commit cap.`]
      : []),
  ];
  return {
    links: boundedLinks,
    sessions,
    completeness: {
      complete: reasons.length === 0,
      sampled: Boolean(posthog?.completeness.sampled || stripe?.completeness.sampled),
      matchedSessions: sessions.length,
      unmatchedSessions,
      ambiguousEmails,
      conflictingDistinctIds,
      truncatedAccountGroups: grouped.truncatedAccountGroups,
      rejectedSourceIds: grouped.rejectedSourceIds,
      omittedIdentityLinks,
      reasons,
    },
  };
}
