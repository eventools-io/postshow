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
    title: 'Postshow · the AI teammate for customer intelligence',
    description:
      'Postshow samples product behavior, investigates why users convert, stall, or churn, and hands you drafted emails, tickets, and plays. Open source, free with your own keys, hosted from $99/mo.',
    path: '/',
  },
  security: {
    title: 'Security and data flow · Postshow',
    description:
      'How Postshow handles customer data: write-only keys, local-only connector boundaries, selected model providers, retention, and deletion.',
    path: '/security',
  },
  openSource: {
    title: 'Open source · Postshow',
    description:
      'Postshow is open core: the app, CLI, MCP server, desktop agent, and engine are MIT; the supported always-on cloud runtime is the business.',
    path: '/open-source',
  },
  terms: {
    title: 'Terms of Service · Postshow',
    description:
      'The terms for Postshow accounts, hosted service, AI output, connected sources, billing, export, and deletion.',
    path: '/terms',
  },
  privacy: {
    title: 'Privacy Policy · Postshow',
    description:
      'How Eventools LLC collects, processes, shares, retains, exports, and deletes information when you use Postshow.',
    path: '/privacy',
  },
  cookies: {
    title: 'Cookies and local storage · Postshow',
    description:
      'The essential browser storage Postshow uses and how optional, consent-based PostHog analytics work.',
    path: '/cookies',
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
