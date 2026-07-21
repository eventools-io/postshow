import { describe, expect, it } from 'vitest';
import { mcpReviewHandoff, mcpSkipArgs } from './mcp';

describe('MCP inbox safety boundary', () => {
  it('returns a token-free authenticated web handoff instead of an execution request', () => {
    const handoff = mcpReviewHandoff(
      { workspaceId: '10000000-0000-4000-8000-000000000001' },
      '00000000-0000-4000-8000-000000000001'
    );

    expect(handoff).toEqual({
      item_id: '00000000-0000-4000-8000-000000000001',
      review_url:
        'https://postshow.io/inbox?workspace=10000000-0000-4000-8000-000000000001&item=00000000-0000-4000-8000-000000000001',
      requires_authenticated_browser: true,
      executed: false,
    });
    expect(handoff).not.toHaveProperty('token');
    expect(handoff).not.toHaveProperty('confirmation_token');
  });

  it('maps the exact listed action revision to the cloud skip contract', () => {
    const itemId = '00000000-0000-4000-8000-000000000001';
    expect(mcpSkipArgs(itemId, 9)).toEqual({ item_id: itemId, expected_revision: 9 });
    for (const revision of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => mcpSkipArgs(itemId, revision)).toThrow(/exact positive action revision/);
    }
    expect(() => mcpSkipArgs('not-a-uuid', 9)).toThrow(/exact positive action revision/);
  });
});
