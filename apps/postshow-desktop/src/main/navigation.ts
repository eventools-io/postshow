export const PRODUCTION_WEB_URL = 'https://postshow.io';
export const DEVELOPMENT_WEB_URL = 'http://localhost:5176';

const DEVELOPMENT_ORIGINS = new Set(['http://localhost:5176', 'http://127.0.0.1:5176']);
const EXTERNAL_HTTPS_ORIGINS = new Set([
  'https://eventools.io',
  'https://www.eventools.io',
  'https://status.eventools.io',
  'https://billing.stripe.com',
  'https://checkout.stripe.com',
]);
const EXTERNAL_MAILTO_RECIPIENTS = new Set(['security@eventools.io', 'support@eventools.io']);

export type NavigationDecision =
  | { action: 'allow'; url: string }
  | { action: 'external'; url: string }
  | { action: 'deny' };

export function resolveWebUrl(isPackaged: boolean, requested?: string): string {
  if (isPackaged) return PRODUCTION_WEB_URL;

  let url: URL;
  try {
    url = new URL(requested ?? DEVELOPMENT_WEB_URL);
  } catch {
    throw new Error('POSTSHOW_WEB_URL must be a valid Postshow development URL');
  }
  if (
    !DEVELOPMENT_ORIGINS.has(url.origin) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'POSTSHOW_WEB_URL must be exactly http://localhost:5176 or http://127.0.0.1:5176'
    );
  }
  return url.origin;
}

export function classifyNavigation(rawUrl: string, trustedWebUrl: string): NavigationDecision {
  let url: URL;
  let trusted: URL;
  try {
    url = new URL(rawUrl);
    trusted = new URL(trustedWebUrl);
  } catch {
    return { action: 'deny' };
  }

  if (url.username || url.password) return { action: 'deny' };
  if (url.origin === trusted.origin && url.protocol === trusted.protocol) {
    return { action: 'allow', url: url.href };
  }
  if (url.protocol === 'https:' && EXTERNAL_HTTPS_ORIGINS.has(url.origin)) {
    return { action: 'external', url: url.href };
  }
  if (
    url.protocol === 'mailto:' &&
    EXTERNAL_MAILTO_RECIPIENTS.has(url.pathname.toLowerCase()) &&
    !url.search &&
    !url.hash
  ) {
    return { action: 'external', url: url.href };
  }
  return { action: 'deny' };
}

export function isTrustedRendererUrl(rawUrl: string, trustedWebUrl: string): boolean {
  return classifyNavigation(rawUrl, trustedWebUrl).action === 'allow';
}
