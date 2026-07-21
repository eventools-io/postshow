import { Link } from 'react-router-dom';
import { openAnalyticsPreferences } from '@/lib/analytics';

export const POSTSHOW_LEGAL = {
  terms: '/terms',
  privacy: '/privacy',
  cookies: '/cookies',
  support: 'mailto:support@eventools.io',
  status: 'https://status.eventools.io',
} as const;

export function LegalLinks({
  theme = 'light',
  layout = 'row',
  showAnalyticsPreferences = true,
  className = '',
}: {
  theme?: 'light' | 'dark';
  layout?: 'row' | 'column';
  showAnalyticsPreferences?: boolean;
  className?: string;
}) {
  const linkClass =
    theme === 'dark'
      ? 'rounded-sm font-public-sans text-[12px] text-night-fg-2 hover:text-night-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'
      : 'rounded-sm font-public-sans text-[12px] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep';
  return (
    <nav
      aria-label="Legal and support"
      className={[
        layout === 'column'
          ? 'flex flex-col items-start gap-2'
          : 'flex flex-wrap items-center gap-x-4 gap-y-2',
        className,
      ].join(' ')}
    >
      <Link to={POSTSHOW_LEGAL.terms} className={linkClass}>
        Terms
      </Link>
      <Link to={POSTSHOW_LEGAL.privacy} className={linkClass}>
        Privacy
      </Link>
      <Link to={POSTSHOW_LEGAL.cookies} className={linkClass}>
        Cookies
      </Link>
      <a href={POSTSHOW_LEGAL.support} className={linkClass}>
        support@eventools.io
      </a>
      <a href={POSTSHOW_LEGAL.status} className={linkClass}>
        Status
      </a>
      {showAnalyticsPreferences ? (
        <button type="button" onClick={openAnalyticsPreferences} className={linkClass}>
          Analytics choices
        </button>
      ) : null}
    </nav>
  );
}
