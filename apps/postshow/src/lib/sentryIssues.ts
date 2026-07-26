import type { SentryIssueConfig } from './types';

const ORG_SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const ISSUE_ID = /^[0-9]{1,32}$/;

export function sentryIssueConfig(meta: Record<string, unknown>): SentryIssueConfig | null {
  const orgSlug = String(meta.org_slug ?? '');
  return ORG_SLUG.test(orgSlug) ? { orgSlug } : null;
}

/** Builds the organization-scoped path rather than the `<org>.sentry.io`
 * subdomain: a Sentry organization slug may contain an underscore, which is not
 * a legal DNS label, and keeping the slug in a path segment pins the host. An
 * identifier that does not match what the reference table accepts gets no link
 * rather than a guessed one. */
export function sentryIssueUrl(config: SentryIssueConfig | null, issueId: string): string | null {
  if (!config || !ORG_SLUG.test(config.orgSlug) || !ISSUE_ID.test(issueId)) return null;
  return `https://sentry.io/organizations/${encodeURIComponent(
    config.orgSlug
  )}/issues/${encodeURIComponent(issueId)}/`;
}
