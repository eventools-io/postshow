import { useEffect, useState } from 'react';
import {
  OPEN_ANALYTICS_PREFERENCES_EVENT,
  getAnalyticsConsent,
  setAnalyticsConsent,
  syncAnalyticsConsent,
  type AnalyticsConsent as AnalyticsConsentChoice,
} from '@/lib/analytics';
import { POSTSHOW_LEGAL } from '@/components/LegalLinks';

export function AnalyticsConsent() {
  const initialChoice = getAnalyticsConsent();
  const [choice, setChoice] = useState<AnalyticsConsentChoice | null>(initialChoice);
  const [open, setOpen] = useState(initialChoice === null);

  useEffect(() => {
    const show = () => setOpen(true);
    const sync = () => {
      const next = syncAnalyticsConsent();
      setChoice(next);
      setOpen(next === null);
    };
    window.addEventListener(OPEN_ANALYTICS_PREFERENCES_EVENT, show);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(OPEN_ANALYTICS_PREFERENCES_EVENT, show);
      window.removeEventListener('storage', sync);
    };
  }, []);

  function choose(next: AnalyticsConsentChoice) {
    setAnalyticsConsent(next);
    setChoice(next);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-[100] rounded-pill border border-night-4 bg-night-1 px-3 py-2 font-public-sans text-[11px] text-night-fg-2 shadow-lg hover:text-night-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Privacy choices
      </button>
    );
  }

  return (
    <section
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-[760px] rounded-lg border border-night-4 bg-night-0 p-4 text-night-fg shadow-2xl sm:p-5"
      role="region"
      aria-labelledby="analytics-consent-title"
      aria-describedby="analytics-consent-detail"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="analytics-consent-title"
            className="m-0 font-public-sans text-[14px] font-medium text-night-fg"
          >
            Optional product analytics
          </h2>
          <p
            id="analytics-consent-detail"
            className="m-0 mt-1 max-w-[62ch] font-public-sans text-[12px] leading-[1.55] text-night-fg-2"
          >
            Help Eventools LLC improve Postshow with product analytics, interaction capture,
            performance signals, and masked session replay. Replay masks page text and every form
            field; console logs, request bodies, and request headers are not recorded.
            Authentication and billing work either way. Read our{' '}
            <a href={POSTSHOW_LEGAL.cookies} className="text-signal hover:text-night-fg">
              Cookies notice
            </a>{' '}
            and{' '}
            <a href={POSTSHOW_LEGAL.privacy} className="text-signal hover:text-night-fg">
              Privacy Policy
            </a>
            .
          </p>
          {choice ? (
            <p className="m-0 mt-2 font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
              Current choice: {choice === 'accepted' ? 'analytics on' : 'analytics off'}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => choose('accepted')} className="ps-btn-primary">
            Accept analytics
          </button>
          <button type="button" onClick={() => choose('declined')} className="ps-btn-ghost">
            Decline
          </button>
          {choice ? (
            <button type="button" onClick={() => setOpen(false)} className="ps-btn-ghost">
              Close
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
