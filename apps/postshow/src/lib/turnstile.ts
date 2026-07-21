export type TurnstileClientConfig =
  | { kind: 'widget'; siteKey: string }
  | { kind: 'bypass' }
  | { kind: 'blocked'; message: string };

export function resolveTurnstileClientConfig({
  siteKey = import.meta.env.VITE_POSTSHOW_TURNSTILE_SITE_KEY,
  bypass = import.meta.env.VITE_POSTSHOW_TURNSTILE_BYPASS,
  production = import.meta.env.PROD,
}: {
  siteKey?: string;
  bypass?: string;
  production?: boolean;
} = {}): TurnstileClientConfig {
  const normalizedKey = siteKey?.trim();
  if (normalizedKey) return { kind: 'widget', siteKey: normalizedKey };
  if (!production && bypass === 'true') return { kind: 'bypass' };
  return {
    kind: 'blocked',
    message: production
      ? 'Security verification is not configured. Account access is temporarily unavailable.'
      : 'Security verification is not configured. Add a Turnstile site key or explicitly enable the local-only bypass.',
  };
}
