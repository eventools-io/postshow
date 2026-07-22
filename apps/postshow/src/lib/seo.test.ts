import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../../../scripts/prerender-postshow-heads.mjs';
import { PAGE_META } from './seo';

describe('public route metadata', () => {
  it('includes canonical metadata for all legal pages', () => {
    expect(PAGE_META.terms?.path).toBe('/terms');
    expect(PAGE_META.privacy?.path).toBe('/privacy');
    expect(PAGE_META.cookies?.path).toBe('/cookies');
    expect(PAGE_META.terms?.noindex).not.toBe(true);
    expect(PAGE_META.privacy?.noindex).not.toBe(true);
    expect(PAGE_META.cookies?.noindex).not.toBe(true);
  });

  it('avoids absolute session and plan promises', () => {
    const copy = Object.values(PAGE_META)
      .flatMap((meta) => [meta.title, meta.description])
      .join(' ');
    expect(copy).not.toMatch(/every session|free forever|\bSSO\b/i);
  });

  it('uses the same metadata for runtime and static prerendering', () => {
    const prerenderedMeta = Object.values(PAGE_META).filter(
      (meta) => meta.path !== '/' && !meta.noindex
    );
    expect(ROUTES).toEqual(prerenderedMeta);
  });
});
