#!/usr/bin/env node
/**
 * Bakes per-route document heads into static HTML for postshow.io.
 *
 * The postshow app is a SPA; Netlify serves dist/index.html for every path.
 * Crawlers that skip JavaScript would otherwise see the landing page's title
 * and canonical on every route. This writes dist/<route>/index.html copies
 * with the route's own title, description, canonical, and og tags swapped in
 * (Netlify serves existing files before the SPA redirect). Keep the values in
 * sync with apps/postshow/src/lib/seo.ts, which owns them at runtime.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/postshow/dist');
const SITE = 'https://postshow.io';

const ROUTES = [
  {
    path: '/security',
    title: 'Security and data flow · Postshow',
    description:
      'Where your customer data goes and where it never goes: write-only keys, local-only connectors, read-only gathering, and the full Postshow data-flow map.',
  },
  {
    path: '/open-source',
    title: 'Open source · Postshow',
    description:
      'Postshow is open core: the app, CLI, MCP server, desktop agent, and engine are MIT; the always-on cloud is the business. Self-host it, or let us run it.',
  },
];

function swapHead(html, route) {
  const url = `${SITE}${route.path}`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${route.description}$2`
    )
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${route.title}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${route.description}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    // Route-specific pages should not carry the landing page's FAQ schema.
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '');
}

function main() {
  const template = readFileSync(join(DIST, 'index.html'), 'utf8');
  for (const route of ROUTES) {
    const target = join(DIST, route.path.slice(1), 'index.html');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, swapHead(template, route), 'utf8');
    console.log(`prerendered head: ${route.path}`);
  }
}

main();
