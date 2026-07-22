import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { posthogReplayConfig, posthogReplayUrl } from '@/lib/replay';
import { ReplayLinks } from './ReplayLinks';

const config = { origin: 'https://us.posthog.com', projectId: '12345' };

describe('PostHog replay links', () => {
  it('builds an exact project-scoped replay link', () => {
    expect(posthogReplayUrl(config, 'session-safe-123')).toBe(
      'https://us.posthog.com/project/12345/replay/session-safe-123'
    );
  });

  it('uses the canonical US host when connection metadata omits the default', () => {
    expect(posthogReplayConfig({ project_id: '12345' })).toEqual(config);
  });

  it('rejects malformed origins and session ids', () => {
    expect(
      posthogReplayUrl({ ...config, origin: 'http://us.posthog.com' }, 'session-safe-123')
    ).toBeNull();
    expect(posthogReplayUrl(config, 'session\nattack')).toBeNull();
  });

  it('deduplicates rendered replay evidence', () => {
    render(
      <ReplayLinks
        config={config}
        sessionIds={['session-safe-123', 'session-safe-123', 'session-safe-456']}
      />
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'replay 1 ↗' })).toHaveAttribute('rel', 'noreferrer');
  });
});
