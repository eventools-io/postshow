import { describe, expect, it } from 'vitest';
import { normalizeSourceEvidenceContext, sourceEvidenceContext } from './evidence';

describe('source evidence context', () => {
  it('reduces connector coverage to a bounded source ledger', () => {
    expect(
      sourceEvidenceContext({
        posthog: { complete: false, sampled: true, returned: 40, available: 112 },
        stripe: { complete: true, sampled: false, returned: 12, available: 12 },
        sentry: 'failed',
        github: { complete: false, sampled: false, returned: 100, available: null },
      })
    ).toEqual({
      version: 1,
      sources: {
        posthog: { state: 'sampled', returned: 40, available: 112 },
        stripe: { state: 'complete', returned: 12, available: 12 },
        sentry: { state: 'failed', returned: 0, available: null },
        github: { state: 'partial', returned: 100, available: null },
      },
    });
  });

  it('normalizes the exact shared shape without accepting prose', () => {
    const context = sourceEvidenceContext({
      posthog: { complete: true, sampled: false, returned: 2, available: 2 },
    });
    expect(normalizeSourceEvidenceContext(context)).toEqual(context);
    expect(() =>
      normalizeSourceEvidenceContext({
        ...context,
        sources: {
          ...context.sources,
          posthog: { ...context.sources.posthog, reason: 'private provider detail' },
        },
      })
    ).toThrow('field is invalid');
    expect(() =>
      normalizeSourceEvidenceContext({ ...context, note: 'private provider detail' })
    ).toThrow('field is invalid');
  });

  it('rejects unknown sources and contradictory coverage', () => {
    const context = sourceEvidenceContext({});
    expect(() =>
      normalizeSourceEvidenceContext({
        ...context,
        sources: { ...context.sources, postgres: context.sources.posthog },
      })
    ).toThrow('source is invalid');
    expect(() =>
      normalizeSourceEvidenceContext({
        ...context,
        sources: {
          ...context.sources,
          posthog: { state: 'complete', returned: 1, available: 2 },
        },
      })
    ).toThrow('completeness contradicts');
    expect(() =>
      normalizeSourceEvidenceContext({
        ...context,
        sources: {
          ...context.sources,
          sentry: { state: 'not_gathered', returned: 1, available: null },
        },
      })
    ).toThrow('not-gathered state is invalid');
  });
});
