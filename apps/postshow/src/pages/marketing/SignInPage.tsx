import { PAGE_META, usePageMeta } from '@/lib/seo';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/state/WorkspaceContext';
import { track } from '@/lib/analytics';
import { Logo } from '@/components/Logo';

type Mode = 'signin' | 'signup';

export function SignInPage() {
  usePageMeta(PAGE_META.signin!);
  const { session, sessionLoading } = useWorkspace();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!sessionLoading && session) return <Navigate to="/inbox" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        track('signup');
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        track('signin');
      }
    } catch (e) {
      // Gateway-level failures surface as errors whose message is empty or
      // raw JSON; show something a person can act on instead.
      const message = e instanceof Error ? e.message.trim() : '';
      setError(
        message && !message.startsWith('{')
          ? message
          : 'Could not reach the sign-in service. Try again in a moment.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-0 px-5">
      <div className="w-full max-w-[420px]">
        <Link
          to="/"
          className="flex w-fit items-center gap-[10px] font-public-sans text-[18px] font-semibold tracking-[-0.02em] text-shell-fg"
        >
          <Logo size={22} />
          Postshow
        </Link>
        <div className="mt-6 rounded-lg border border-shell-3 bg-shell-1 p-7">
          <h1 className="m-0 font-public-sans text-[22px] font-semibold text-shell-fg">
            {mode === 'signin' ? 'Sign in' : 'Create your account'}
          </h1>
          <p className="m-0 mt-1 font-public-sans text-[13px] leading-[1.5] text-shell-fg-2">
            {mode === 'signin'
              ? 'Your workspace, its accounts, and the night log live behind this door.'
              : 'A workspace takes about a minute to set up.'}
          </p>
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="mk-eyebrow text-shell-fg-3">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-md border border-shell-3 bg-shell-0 px-3 font-public-sans text-[14px] text-shell-fg placeholder:text-shell-fg-3 focus:border-signal-deep focus:outline-none"
                placeholder="you@company.com"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mk-eyebrow text-shell-fg-3">Password</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-md border border-shell-3 bg-shell-0 px-3 font-public-sans text-[14px] text-shell-fg placeholder:text-shell-fg-3 focus:border-signal-deep focus:outline-none"
                placeholder="••••••••"
              />
            </label>
            {error && (
              <p className="m-0 font-public-sans text-[13px] text-bad" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="m-0 font-public-sans text-[13px] text-signal-deep" role="status">
                {notice}
              </p>
            )}
            <button type="submit" disabled={busy} className="mk-btn-dark mt-1 w-full">
              {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError('');
              setNotice('');
            }}
            className="mt-4 rounded-sm font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
          >
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        </div>
        <p className="m-0 mt-4 font-public-mono text-[11px] uppercase tracking-[0.12em] text-shell-fg-3">
          an eventools product
        </p>
      </div>
    </div>
  );
}
