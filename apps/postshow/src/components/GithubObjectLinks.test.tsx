import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GithubObjectLinks } from './GithubObjectLinks';
import type { IncidentReference } from '@/lib/types';

function reference(overrides: Partial<IncidentReference>): IncidentReference {
  return {
    id: crypto.randomUUID(),
    provider: 'github',
    object_type: 'pull_request',
    sentry_issue_id: null,
    github_repo: 'northwind-labs/invoice-web',
    github_object_id: '812',
    ...overrides,
  };
}

describe('GithubObjectLinks', () => {
  it('links each object kind to the path GitHub actually serves', () => {
    render(
      <GithubObjectLinks
        references={[
          reference({}),
          reference({ object_type: 'commit', github_object_id: 'a'.repeat(40) }),
          reference({ object_type: 'issue', github_object_id: '796' }),
        ]}
      />
    );

    expect(screen.getByRole('link', { name: /pull #812/ })).toHaveAttribute(
      'href',
      'https://github.com/northwind-labs/invoice-web/pull/812'
    );
    expect(screen.getByRole('link', { name: /commit aaaaaaa/ })).toHaveAttribute(
      'href',
      `https://github.com/northwind-labs/invoice-web/commit/${'a'.repeat(40)}`
    );
    expect(screen.getByRole('link', { name: /issue #796/ })).toHaveAttribute(
      'href',
      'https://github.com/northwind-labs/invoice-web/issues/796'
    );
  });

  it('renders nothing rather than a guessed link when a row cannot be resolved', () => {
    const { container } = render(
      <GithubObjectLinks
        references={[
          reference({ github_repo: 'not a repo' }),
          reference({ object_type: 'commit', github_object_id: 'abc123' }),
          reference({ object_type: 'repository', github_object_id: '1' }),
          reference({ github_object_id: null }),
        ]}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows one link per object when several findings cite the same one', () => {
    render(<GithubObjectLinks references={[reference({}), reference({})]} />);

    expect(screen.getAllByRole('link', { name: /pull #812/ })).toHaveLength(1);
  });
});
