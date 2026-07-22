import { useRef, useState, type FormEvent } from 'react';
import { joinWaitlist } from '@/lib/waitlist';

type FormState = 'idle' | 'submitting' | 'joined' | 'invalid' | 'error';

/** Waitlist form for the dark closing slab. Netlify detects the matching static
 * form skeleton at build time and stores each beta signup submission. */
export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const requestId = useRef<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'submitting') return;
    requestId.current ??= crypto.randomUUID();
    setState('submitting');
    const result = await joinWaitlist(email, requestId.current);
    setState(result);
  }

  if (state === 'joined') {
    return (
      <p className="m-0 flex items-center gap-2 font-public-mono text-[13px] uppercase tracking-[0.12em] text-signal">
        <span className="inline-block h-[6px] w-[6px] bg-signal" aria-hidden />
        You&rsquo;re on the list.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-[440px] flex-col items-center gap-3">
      <form
        name="beta-signup"
        method="POST"
        data-netlify="true"
        onSubmit={handleSubmit}
        className="flex w-full flex-col gap-3"
      >
        <input type="hidden" name="form-name" value="beta-signup" />
        <input type="hidden" name="source" value="landing" />
        <input type="hidden" name="request_id" value={requestId.current ?? ''} />
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <label htmlFor="waitlist-email" className="sr-only">
            Email address
          </label>
          <input
            id="waitlist-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              requestId.current = null;
              if (state === 'invalid' || state === 'error') setState('idle');
            }}
            className="h-11 flex-1 rounded-pill border border-night-4 bg-night-2 px-5 font-public-sans text-[14px] text-night-fg placeholder:text-night-fg-3 focus:border-signal focus:outline-none"
          />
          <button type="submit" disabled={state === 'submitting'} className="mk-btn-signal">
            {state === 'submitting' ? 'Joining…' : 'Join the waitlist'}
          </button>
        </div>
      </form>
      {state === 'invalid' && (
        <p className="m-0 font-public-sans text-[13px] text-night-fg-2" role="alert">
          That email doesn&rsquo;t look right. Check it and try again.
        </p>
      )}
      {state === 'error' && (
        <p className="m-0 font-public-sans text-[13px] text-night-fg-2" role="alert">
          Something broke on our end. Try again in a minute.
        </p>
      )}
      <p className="m-0 font-public-mono text-[11px] uppercase tracking-[0.12em] text-night-fg-3">
        No spam, no drip sequence.
      </p>
    </div>
  );
}
