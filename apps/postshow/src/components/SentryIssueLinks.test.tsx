import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sentryIssueConfig, sentryIssueUrl } from '@/lib/sentryIssues';
import type { IncidentReference } from '@/lib/types';
import { SentryIssueLinks } from './SentryIssueLinks';

const config = { orgSlug: 'acme' };

function reference(sentry_issue_id: string): IncidentReference {
  return {
    id: `row-${sentry_issue_id}`,
    provider: 'sentry',
    object_type: 'issue',
    sentry_issue_id,
  };
}

describe('Sentry issue links', () => {
  it('builds an organization-scoped issue link from the stored identifier', () => {
    expect(sentryIssueUrl(config, '6042118')).toBe(
      'https://sentry.io/organizations/acme/issues/6042118/'
    );
  });

  it('reads the organization slug from connection metadata', () => {
    expect(sentryIssueConfig({ org_slug: 'acme', project_slug: 'frontend' })).toEqual(config);
    expect(sentryIssueConfig({ project_slug: 'frontend' })).toBeNull();
  });

  it('refuses slugs and identifiers the reference table would not accept', () => {
    expect(sentryIssueUrl({ orgSlug: 'acme/../evil' }, '6042118')).toBeNull();
    expect(sentryIssueUrl(config, '6042118/../../evil')).toBeNull();
    expect(sentryIssueUrl(config, 'javascript:alert(1)')).toBeNull();
    expect(sentryIssueUrl(null, '6042118')).toBeNull();
  });

  it('renders one deduplicated citation per issue and nothing without a connection', () => {
    const references = [reference('6042118'), reference('6042118'), reference('99')];
    const { unmount } = render(<SentryIssueLinks references={references} config={config} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'issue 6042118 ↗' })).toHaveAttribute(
      'rel',
      'noreferrer'
    );
    unmount();

    render(<SentryIssueLinks references={references} config={null} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
