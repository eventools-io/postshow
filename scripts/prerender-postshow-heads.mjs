#!/usr/bin/env node
/**
 * Bakes per-route document heads into static HTML for postshow.io.
 *
 * The postshow app is a SPA; Netlify serves dist/index.html for every path.
 * Crawlers that skip JavaScript would otherwise see the landing page's title
 * and canonical on every route. This writes dist/<route>/index.html copies
 * with the route's own title, description, canonical, and og tags swapped in
 * (Netlify serves existing files before the SPA redirect). Runtime and build
 * both read apps/postshow/src/lib/page-meta.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/postshow/dist');
const SITE = 'https://postshow.io';
const META_FILE = join(ROOT, 'apps/postshow/src/lib/page-meta.json');
const PAGE_META = JSON.parse(readFileSync(META_FILE, 'utf8'));

export const ROUTES = Object.values(PAGE_META).filter((meta) => meta.path !== '/' && !meta.noindex);

function swapHead(html, route) {
  const url = `${SITE}${route.path}`;
  return (
    html
      .replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`)
      .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${route.description}$2`)
      .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${route.title}$2`)
      .replace(
        /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
        `$1${route.description}$2`
      )
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
      // Route-specific pages should not carry the landing page's FAQ schema.
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '')
  );
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
