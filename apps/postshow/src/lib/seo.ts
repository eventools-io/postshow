// Per-route document head management. The build also bakes these values into
// static per-route HTML (scripts/prerender-postshow-heads.mjs) so crawlers
// that skip JavaScript still see the right title, description, and canonical;
// this hook keeps the head correct during client-side navigation.

import { useEffect } from 'react';
import pageMeta from './page-meta.json';

export const SITE_URL = 'https://postshow.io';

export interface PageMeta {
  title: string;
  description: string;
  /** Route path starting with '/'; becomes the canonical URL. */
  path: string;
  /** App routes are noindex; marketing routes index. */
  noindex?: boolean;
}

export const PAGE_META: Record<string, PageMeta> = pageMeta;

function setMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let tag = document.head.querySelector<globalThis.HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export function usePageMeta(meta: PageMeta): void {
  useEffect(() => {
    document.title = meta.title;
    setMeta('name', 'description', meta.description);
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    setMeta('property', 'og:url', `${SITE_URL}${meta.path === '/' ? '' : meta.path}`);
    setMeta('name', 'robots', meta.noindex ? 'noindex' : 'index,follow');

    let canonical =
      document.head.querySelector<globalThis.HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = `${SITE_URL}${meta.path === '/' ? '' : meta.path}`;
  }, [meta]);
}
