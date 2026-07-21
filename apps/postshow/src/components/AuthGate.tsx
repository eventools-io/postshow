import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useWorkspace } from '@/state/WorkspaceContext';
import { Logo } from '@/components/Logo';
import { LegalLinks, POSTSHOW_LEGAL } from '@/components/LegalLinks';
import { POSTSHOW_LEGAL_EFFECTIVE_DATE } from '@/lib/legalAcceptance';

function WorkspaceScreen() {
  const { createWorkspace, signOut } = useWorkspace();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [error, setError] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!legalAccepted) {
      setError('Agree to the current Terms and acknowledge the Privacy Policy first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createWorkspace(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    setError('');
    try {
      await signOut();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Sign out could not be completed.');
      setSignOutBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-0 px-5">
      <div className="w-full max-w-[420px]">
        <span className="flex items-center gap-[10px] font-public-sans text-[18px] font-semibold tracking-[-0.02em] text-shell-fg">
          <Logo size={22} />
          Postshow
        </span>
        <div className="mt-6 rounded-lg border border-shell-3 bg-shell-1 p-7">
          <h1 className="m-0 font-public-sans text-[22px] font-semibold text-shell-fg">
            Name your workspace
          </h1>
          <p className="m-0 mt-1 font-public-sans text-[13px] leading-[1.5] text-shell-fg-2">
            Usually your company name. Connections, the inbox, and the work plan live here.
          </p>
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="mk-eyebrow text-shell-fg-3">Workspace name</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="h-11 w-full rounded-md border border-shell-3 bg-shell-0 px-3 font-public-sans text-[14px] text-shell-fg placeholder:text-shell-fg-3 focus:border-signal-deep focus:outline-none"
                placeholder="Acme Cloud"
              />
            </label>
            {error && (
              <p className="m-0 font-public-sans text-[13px] text-bad" role="alert">
                {error}
              </p>
            )}
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
            <button
              type="submit"
              disabled={busy || !legalAccepted}
              className="mk-btn-dark mt-1 w-full"
            >
              {busy ? 'Creating…' : 'Create workspace'}
            </button>
          </form>
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signOutBusy}
          className="mt-4 rounded-sm font-public-sans text-[13px] text-shell-fg-3 hover:text-shell-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
        >
          {signOutBusy ? 'Signing out…' : 'Sign out'}
        </button>
        <LegalLinks className="mt-4" />
      </div>
    </div>
  );
}

function LoadFailure({
  title,
  detail,
  retry,
  signOut,
}: {
  title: string;
  detail: string;
  retry: () => void;
  signOut?: () => Promise<void>;
}) {
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  async function handleSignOut() {
    if (!signOut || signOutBusy) return;
    setSignOutBusy(true);
    setSignOutError('');
    try {
      await signOut();
    } catch (value) {
      setSignOutError(value instanceof Error ? value.message : 'Sign out could not be completed.');
      setSignOutBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-0 px-5">
      <div className="w-full max-w-[460px] rounded-lg border border-shell-3 bg-shell-1 p-7">
        <span className="flex items-center gap-[10px] font-public-sans text-[18px] font-semibold text-shell-fg">
          <Logo size={22} />
          Postshow
        </span>
        <h1 className="m-0 mt-6 font-public-sans text-[22px] font-semibold text-shell-fg">
          {title}
        </h1>
        <p
          className="m-0 mt-2 font-public-sans text-[13px] leading-[1.55] text-shell-fg-2"
          role="alert"
        >
          {detail}
        </p>
        {signOutError ? (
          <p className="m-0 mt-2 font-public-sans text-[13px] text-bad" role="alert">
            {signOutError}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={retry} className="mk-btn-dark" autoFocus>
            Try again
          </button>
          {signOut ? (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signOutBusy}
              className="mk-btn-light"
            >
              {signOutBusy ? 'Signing out…' : 'Sign out'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Gates the app cluster: unauthenticated → /signin; authenticated without a
 * workspace → workspace creation; otherwise the app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const {
    session,
    sessionLoading,
    sessionError,
    workspace,
    workspaceLoading,
    workspaceError,
    reloadSession,
    reloadWorkspace,
    signOut,
  } = useWorkspace();

  if (sessionLoading || (session && workspaceLoading && !workspace)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-shell-0">
        <span className="mk-eyebrow text-shell-fg-3">loading…</span>
      </div>
    );
  }
  if (sessionError) {
    return (
      <LoadFailure
        title="We couldn’t verify your session"
        detail={sessionError}
        retry={reloadSession}
      />
    );
  }
  if (!session) return <Navigate to="/signin" replace />;
  if (workspaceError) {
    return (
      <LoadFailure
        title="Your workspace didn’t load"
        detail={workspaceError}
        retry={() => void reloadWorkspace()}
        signOut={signOut}
      />
    );
  }
  if (!workspace) return <WorkspaceScreen key={session.user.id} />;
  return <>{children}</>;
}
