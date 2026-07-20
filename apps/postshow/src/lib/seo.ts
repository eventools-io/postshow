// Per-route document head management. The build also bakes these values into
// static per-route HTML (scripts/prerender-postshow-heads.mjs) so crawlers
// that skip JavaScript still see the right title, description, and canonical;
// this hook keeps the head correct during client-side navigation.

import { useEffect } from 'react';

export const SITE_URL = 'https://postshow.io';

export interface PageMeta {
  title: string;
  description: string;
  /** Route path starting with '/'; becomes the canonical URL. */
  path: string;
  /** App routes are noindex; marketing routes index. */
  noindex?: boolean;
}

export const PAGE_META: Record<string, PageMeta> = {
  landing: {
    title: 'Postshow · the AI teammate that watches every user session',
    description:
      'Postshow watches every product session, works out why users convert, stall, or churn, and hands you drafted emails, tickets, and plays. Open source, free with your own keys, hosted from $99/mo.',
    path: '/',
  },
  security: {
    title: 'Security and data flow · Postshow',
    description:
      'Where your customer data goes and where it never goes: write-only keys, local-only connectors, read-only gathering, and the full Postshow data-flow map.',
    path: '/security',
  },
  openSource: {
    title: 'Open source · Postshow',
    description:
      'Postshow is open core: the app, CLI, MCP server, desktop agent, and engine are MIT; the always-on cloud is the business. Self-host it, or let us run it.',
    path: '/open-source',
  },
  signin: {
    title: 'Sign in · Postshow',
    description: 'Sign in to your Postshow workspace.',
    path: '/signin',
    noindex: true,
  },
};

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
