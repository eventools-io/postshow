import { PAGE_META, usePageMeta } from '@/lib/seo';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/state/WorkspaceContext';
import { track } from '@/lib/analytics';
import { Logo } from '@/components/Logo';
import { LegalLinks, POSTSHOW_LEGAL } from '@/components/LegalLinks';
import { fetchPublicReleaseGates } from '@/lib/auth';
import { useInvitationFragmentToken } from '@/lib/invitationFragment';
import {
  POSTSHOW_LEGAL_EFFECTIVE_DATE,
  signupLegalAcceptanceMetadata,
} from '@/lib/legalAcceptance';

type Mode = 'signin' | 'signup' | 'forgot' | 'update';

function initialMode(value: string | null): Mode {
  return value === 'signup' || value === 'forgot' || value === 'update' ? value : 'signin';
}

function weakPasswordMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const error = value as { name?: unknown; code?: unknown; reasons?: unknown };
  if (error.name !== 'AuthWeakPasswordError' && error.code !== 'weak_password') return null;
  const reasons = Array.isArray(error.reasons)
    ? error.reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
  const guidance = new Set<string>();
  if (reasons.includes('length')) guidance.add('use at least 12 characters');
  if (reasons.includes('characters')) guidance.add('mix letters, numbers, and symbols');
  if (reasons.includes('pwned')) guidance.add('choose one not found in known breach data');
  return guidance.size > 0
    ? `Choose a stronger password: ${[...guidance].join('; ')}.`
    : 'Choose a stronger password with at least 12 characters.';
}

function publicAuthError(value: unknown, mode: Mode): string {
  const weak = weakPasswordMessage(value);
  if (weak && (mode === 'signup' || mode === 'update')) return weak;
  switch (mode) {
    case 'signin':
      return 'Sign-in failed. Check your email and password, then try again.';
    case 'signup':
      return 'Your account could not be created. Check the form and try again.';
    case 'forgot':
      return 'Password recovery could not be requested. Check the email and try again.';
    case 'update':
      return 'Your password could not be updated. Request a new reset link and try again.';
  }
}

export function SignInPage() {
  usePageMeta(PAGE_META.signin!);
  const { session, sessionLoading, sessionError, reloadSession } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const invite = useInvitationFragmentToken();
  const [mode, setMode] = useState<Mode>(() => initialMode(searchParams.get('mode')));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signupEnabled, setSignupEnabled] = useState<boolean | null>(null);
  const [legalAccepted, setLegalAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicReleaseGates()
      .then((gates) => {
        if (!cancelled) setSignupEnabled(gates.signup);
      })
      .catch(() => {
        if (!cancelled) setSignupEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'signup' || signupEnabled !== false || invite) return;
    setMode('signin');
    setLegalAccepted(false);
    const params = new URLSearchParams(searchParams);
    params.delete('mode');
    setSearchParams(params, { replace: true });
    setNotice('New Postshow workspaces are currently invite-only. Existing accounts can sign in.');
  }, [invite, mode, searchParams, setSearchParams, signupEnabled]);

  if (!sessionLoading && session && mode !== 'update') {
    return <Navigate to={invite ? `/invite#token=${invite}` : '/inbox'} replace />;
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setPasswordConfirmation('');
    setLegalAccepted(false);
    const params = new URLSearchParams(searchParams);
    if (next === 'signin') params.delete('mode');
    else params.set('mode', next);
    setSearchParams(params, { replace: true });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'signup') {
        if (signupEnabled !== true && !invite)
          throw new Error('New account signup is not open yet.');
        if (!legalAccepted) throw new Error('Accept the current legal terms before continuing.');
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: signupLegalAcceptanceMetadata(),
            emailRedirectTo: invite
              ? `${window.location.origin}/invite`
              : `${window.location.origin}/signin`,
          },
        });
        if (signUpError) throw signUpError;
        track('signup');
        if (!data.session) {
          setNotice(
            invite
              ? 'Check your email to confirm your account, then reopen the original invitation link. For security, the invitation is not copied into the confirmation URL.'
              : 'Check your email to confirm your account, then sign in.'
          );
        }
      } else if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/signin?mode=update`,
        });
        if (resetError) throw resetError;
        setNotice(
          'If an account exists for that email, a password-reset link is on its way. The link expires for your security.'
        );
      } else if (mode === 'update') {
        if (!session) {
          setError('This reset link is invalid or expired. Request a new one.');
          return;
        }
        if (password !== passwordConfirmation) {
          setError('The new passwords do not match.');
          return;
        }
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        track('password_updated');
        switchMode('signin');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        track('signin');
      }
    } catch (value) {
      setError(publicAuthError(value, mode));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === 'signin'
      ? 'Sign in'
      : mode === 'signup'
        ? 'Create your account'
        : mode === 'forgot'
          ? 'Reset your password'
          : 'Choose a new password';
  const submitLabel =
    mode === 'signin'
      ? 'Sign in'
      : mode === 'signup'
        ? 'Create account'
        : mode === 'forgot'
          ? 'Send reset link'
          : 'Save new password';

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-0 px-5 py-8">
      <div className="w-full max-w-[420px]">
        <Link
          to="/"
          className="flex w-fit items-center gap-[10px] font-public-sans text-[18px] font-semibold tracking-[-0.02em] text-shell-fg"
        >
          <Logo size={22} />
          Postshow
        </Link>
        <div className="mt-6 rounded-lg border border-shell-3 bg-shell-1 p-5 sm:p-7">
          <h1 className="m-0 font-public-sans text-[22px] font-semibold text-shell-fg">{title}</h1>
          <p className="m-0 mt-1 font-public-sans text-[13px] leading-[1.5] text-shell-fg-2">
            {mode === 'forgot'
              ? 'Enter your account email. We will send a single-use reset link.'
              : mode === 'update'
                ? 'Use a unique password with at least 12 characters.'
                : mode === 'signup'
                  ? invite
                    ? 'Create the Postshow account that will accept this workspace invitation.'
                    : 'Create a Postshow account for your workspace.'
                  : 'Sign in with your Postshow account.'}
          </p>

          {sessionError ? (
            <div className="mt-4 rounded-md border border-bad/30 bg-shell-0 p-3">
              <p className="m-0 font-public-sans text-[13px] text-bad" role="alert">
                {sessionError}
              </p>
              <button type="button" onClick={reloadSession} className="mk-btn-light mt-3">
                Retry session
              </button>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            {mode !== 'update' ? (
              <label className="flex flex-col gap-1">
                <span className="mk-eyebrow text-shell-fg-3">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoFocus
                  className="h-11 w-full rounded-md border border-shell-3 bg-shell-0 px-3 font-public-sans text-[16px] text-shell-fg placeholder:text-shell-fg-3 focus:border-signal-deep focus:outline-none sm:text-[14px]"
                  placeholder="you@company.com"
                />
              </label>
            ) : null}
            {mode !== 'forgot' ? (
              <label className="flex flex-col gap-1">
                <span className="mk-eyebrow text-shell-fg-3">
                  {mode === 'update' ? 'New password' : 'Password'}
                </span>
                <input
                  type="password"
                  required
                  minLength={mode === 'signin' ? undefined : 12}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus={mode === 'update'}
                  className="h-11 w-full rounded-md border border-shell-3 bg-shell-0 px-3 font-public-sans text-[16px] text-shell-fg placeholder:text-shell-fg-3 focus:border-signal-deep focus:outline-none sm:text-[14px]"
                  placeholder="••••••••"
                />
              </label>
            ) : null}
            {mode === 'update' ? (
              <label className="flex flex-col gap-1">
                <span className="mk-eyebrow text-shell-fg-3">Confirm new password</span>
                <input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  className="h-11 w-full rounded-md border border-shell-3 bg-shell-0 px-3 font-public-sans text-[16px] text-shell-fg placeholder:text-shell-fg-3 focus:border-signal-deep focus:outline-none sm:text-[14px]"
                  placeholder="••••••••"
                />
              </label>
            ) : null}
            {error ? (
              <p className="m-0 font-public-sans text-[13px] text-bad" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p
                className="m-0 font-public-sans text-[13px] leading-[1.5] text-signal-deep"
                role="status"
                aria-live="polite"
              >
                {notice}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={
                busy ||
                (mode === 'update' && sessionLoading) ||
                (mode === 'signup' && !legalAccepted)
              }
              className="mk-btn-dark mt-1 w-full"
            >
              {busy || (mode === 'update' && sessionLoading) ? 'Working…' : submitLabel}
            </button>
            {mode === 'signup' ? (
              <label className="flex items-start gap-2 rounded-md border border-shell-3 bg-shell-0 p-3">
                <input
                  type="checkbox"
                  required
                  checked={legalAccepted}
                  onChange={(event) => setLegalAccepted(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-signal-deep"
                />
                <span className="font-public-sans text-[11px] leading-[1.5] text-shell-fg-3">
                  I agree to Eventools LLC&rsquo;s{' '}
                  <a href={POSTSHOW_LEGAL.terms} className="underline hover:text-shell-fg">
                    Terms
                  </a>{' '}
                  and acknowledge the{' '}
                  <a href={POSTSHOW_LEGAL.privacy} className="underline hover:text-shell-fg">
                    Privacy Policy
                  </a>{' '}
                  effective {POSTSHOW_LEGAL_EFFECTIVE_DATE}.
                </span>
              </label>
            ) : null}
          </form>

          <div className="mt-4 flex flex-col items-start gap-2">
            {mode === 'signin' ? (
              <>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="rounded-sm font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
                >
                  Forgot your password?
                </button>
                {signupEnabled === true || invite ? (
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="rounded-sm font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
                  >
                    New here? Create an account
                  </button>
                ) : signupEnabled === false ? (
                  <span className="font-public-sans text-[12px] text-shell-fg-3">
                    New workspaces are currently invite-only. Open your invitation link to create an
                    invited account.
                  </span>
                ) : null}
              </>
            ) : mode === 'signup' ? (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="rounded-sm font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
              >
                Have an account? Sign in
              </button>
            ) : mode === 'forgot' ? (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="rounded-sm font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
              >
                Back to sign in
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="rounded-sm font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
              >
                Request a new reset link
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <p className="m-0 font-public-mono text-[11px] uppercase tracking-[0.12em] text-shell-fg-3">
            an eventools product
          </p>
          <LegalLinks />
        </div>
      </div>
    </div>
  );
}
