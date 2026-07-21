import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
} from 'react';
import { resolveTurnstileClientConfig } from '@/lib/turnstile';

export type TurnstileAction =
  | 'sign_in'
  | 'sign_up'
  | 'password_recovery'
  | 'postshow_waitlist_join';

export interface TurnstileChallengeHandle {
  reset: () => void;
}

interface TurnstileOptions {
  sitekey: string;
  action: TurnstileAction;
  theme: 'light';
  size: 'flexible';
  'response-field': false;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  'error-callback': (code: string) => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

type WindowWithTurnstile = typeof window & { turnstile?: TurnstileApi };

const SCRIPT_ID = 'postshow-cloudflare-turnstile';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | null = null;

function currentApi(): TurnstileApi | undefined {
  return (window as WindowWithTurnstile).turnstile;
}

function loadTurnstile(): Promise<TurnstileApi> {
  const existingApi = currentApi();
  if (existingApi) return Promise.resolve(existingApi);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.getElementById(SCRIPT_ID);
    const script = existingScript ?? document.createElement('script');
    if (!existingScript) {
      const createdScript = script as ReturnType<typeof document.createElement> & {
        src: string;
        async: boolean;
        defer: boolean;
      };
      createdScript.id = SCRIPT_ID;
      createdScript.src = SCRIPT_URL;
      createdScript.async = true;
      createdScript.defer = true;
      document.head.append(createdScript);
    }
    const finish = () => {
      const api = currentApi();
      if (api) resolve(api);
      else reject(new Error('Turnstile loaded without its browser API.'));
    };
    const fail = () => reject(new Error('Turnstile could not be loaded.'));
    const timeout = window.setTimeout(fail, 15_000);
    script.addEventListener(
      'load',
      () => {
        window.clearTimeout(timeout);
        finish();
      },
      { once: true }
    );
    script.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeout);
        fail();
      },
      { once: true }
    );
  }).catch((error: unknown) => {
    scriptPromise = null;
    document.getElementById(SCRIPT_ID)?.remove();
    throw error;
  });
  return scriptPromise;
}

function TurnstileChallengeInner(
  {
    action,
    onChange,
  }: {
    action: TurnstileAction;
    onChange: (token: string | null, bypassed: boolean) => void;
  },
  ref: ForwardedRef<TurnstileChallengeHandle>
) {
  const config = resolveTurnstileClientConfig();
  const configKind = config.kind;
  const configSiteKey = config.kind === 'widget' ? config.siteKey : '';
  const configMessage = config.kind === 'blocked' ? config.message : '';
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'verified' | 'bypass' | 'error'>(
    config.kind === 'bypass' ? 'bypass' : config.kind === 'blocked' ? 'error' : 'loading'
  );
  const [error, setError] = useState(config.kind === 'blocked' ? config.message : '');
  const [attempt, setAttempt] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        onChange(null, config.kind === 'bypass');
        if (config.kind === 'bypass') {
          setState('bypass');
          return;
        }
        const api = currentApi();
        if (api && widgetId.current) {
          api.reset(widgetId.current);
          setState('ready');
          setError('');
        }
      },
    }),
    [config.kind, onChange]
  );

  useEffect(() => {
    if (configKind === 'bypass') {
      setState('bypass');
      setError('');
      onChange(null, true);
      return;
    }
    if (configKind === 'blocked') {
      setState('error');
      setError(configMessage);
      onChange(null, false);
      return;
    }
    let cancelled = false;
    setState('loading');
    setError('');
    onChange(null, false);
    void loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: configSiteKey,
          action,
          theme: 'light',
          size: 'flexible',
          'response-field': false,
          callback(token) {
            if (cancelled) return;
            setState('verified');
            setError('');
            onChange(token, false);
          },
          'expired-callback'() {
            if (cancelled) return;
            setState('ready');
            setError('Security verification expired. Complete it again.');
            onChange(null, false);
          },
          'timeout-callback'() {
            if (cancelled) return;
            setState('ready');
            setError('Security verification timed out. Complete it again.');
            onChange(null, false);
          },
          'error-callback'() {
            if (cancelled) return;
            setState('error');
            setError('Security verification failed to load. Retry the challenge.');
            onChange(null, false);
          },
        });
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
        setError('Security verification could not be loaded. Check your connection and retry.');
        onChange(null, false);
      });
    return () => {
      cancelled = true;
      const api = currentApi();
      if (api && widgetId.current) api.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action, attempt, configKind, configMessage, configSiteKey, onChange]);

  return (
    <div
      className="rounded-md border border-shell-3 bg-shell-0 p-3"
      role="group"
      aria-label="Security verification"
    >
      {config.kind === 'widget' ? <div ref={container} className="min-h-[65px]" /> : null}
      {state === 'loading' ? (
        <p className="m-0 font-public-sans text-[12px] text-shell-fg-2" role="status">
          Loading security verification…
        </p>
      ) : null}
      {state === 'verified' ? (
        <p className="m-0 mt-1 font-public-sans text-[12px] text-signal-deep" role="status">
          Security verification complete.
        </p>
      ) : null}
      {state === 'bypass' ? (
        <p className="m-0 font-public-sans text-[11px] text-warn" role="status">
          Explicit local-only security bypass enabled.
        </p>
      ) : null}
      {error ? (
        <div className="mt-2" role="alert">
          <p className="m-0 font-public-sans text-[12px] leading-[1.5] text-bad">{error}</p>
          {config.kind === 'widget' && state === 'error' ? (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-2 rounded-sm font-public-sans text-[12px] text-shell-fg underline"
            >
              Retry verification
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const TurnstileChallenge = forwardRef(TurnstileChallengeInner);
