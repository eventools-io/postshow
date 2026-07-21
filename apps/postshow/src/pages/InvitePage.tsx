import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { LegalLinks, POSTSHOW_LEGAL } from '@/components/LegalLinks';
import { acceptInvitationToken } from '@/lib/api';
import { useInvitationFragmentToken } from '@/lib/invitationFragment';
import {
  POSTSHOW_LEGAL_EFFECTIVE_DATE,
  recordPostshowLegalAcceptance,
} from '@/lib/legalAcceptance';
import { useWorkspace } from '@/state/WorkspaceContext';

export function InvitePage() {
  const token = useInvitationFragmentToken();
  const { session, sessionLoading, reloadWorkspace, signOut } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const actorId = session?.user.id ?? null;
  const actorRef = useRef(actorId);

  useEffect(() => {
    actorRef.current = actorId;
    setLegalAccepted(false);
    setBusy(false);
    setError('');
  }, [actorId]);

  async function accept() {
    if (!token || !session || busy || !legalAccepted) return;
    const acceptingFor = session.user.id;
    setBusy(true);
    setError('');
    try {
      await recordPostshowLegalAcceptance('invitation_acceptance');
      if (actorRef.current !== acceptingFor) return;
      const workspaceId = await acceptInvitationToken(token);
      if (actorRef.current !== acceptingFor) return;
      await reloadWorkspace(workspaceId);
      if (actorRef.current !== acceptingFor) return;
      setJoined(true);
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : 'The invitation could not be accepted. Ask the workspace administrator for a new link.'
      );
      setBusy(false);
    }
  }

  async function changeAccount() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signOut();
      setBusy(false);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Sign out could not be completed.');
      setBusy(false);
    }
  }

  if (joined) return <Navigate to="/inbox" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-0 px-5 py-8">
      <div className="w-full max-w-[440px]">
        <Link
          to="/"
          className="flex w-fit items-center gap-[10px] font-public-sans text-[18px] font-semibold tracking-[-0.02em] text-shell-fg"
        >
          <Logo size={22} />
          Postshow
        </Link>
        <main className="mt-6 rounded-lg border border-shell-3 bg-shell-1 p-5 sm:p-7">
          <p className="mk-eyebrow m-0 text-signal-deep">Workspace invitation</p>
          <h1 className="m-0 mt-2 font-public-sans text-[22px] font-semibold text-shell-fg">
            Join your team in Postshow
          </h1>
          {!token ? (
            <>
              <p className="m-0 mt-3 font-public-sans text-[13px] leading-[1.55] text-shell-fg-2">
                This invitation link is incomplete or invalid. Ask the workspace administrator for a
                new one.
              </p>
              <Link to="/signin" className="mk-btn-dark mt-5 inline-flex">
                Go to sign in
              </Link>
            </>
          ) : sessionLoading ? (
            <p className="m-0 mt-4 font-public-sans text-[13px] text-shell-fg-2" role="status">
              Checking your session…
            </p>
          ) : session ? (
            <>
              <p className="m-0 mt-3 font-public-sans text-[13px] leading-[1.55] text-shell-fg-2">
                You are signed in as{' '}
                <strong className="font-semibold text-shell-fg">{session.user.email}</strong>. The
                invitation can only be accepted by the exact invited, confirmed email address.
              </p>
              {error ? (
                <p className="m-0 mt-3 font-public-sans text-[13px] text-bad" role="alert">
                  {error}
                </p>
              ) : null}
              <label className="mt-4 flex items-start gap-2 rounded-md border border-shell-3 bg-shell-0 p-3">
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
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void accept()}
                  disabled={busy || !legalAccepted}
                  className="mk-btn-dark"
                >
                  {busy ? 'Joining…' : 'Join workspace'}
                </button>
                <button
                  type="button"
                  onClick={() => void changeAccount()}
                  disabled={busy}
                  className="mk-btn-light"
                >
                  Use another account
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="m-0 mt-3 font-public-sans text-[13px] leading-[1.55] text-shell-fg-2">
                Sign in with the invited email address, or create that account. Postshow verifies
                the invitation again before adding you to the workspace.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={`/signin#token=${token}`} className="mk-btn-dark">
                  Sign in to accept
                </Link>
                <Link to={`/signin?mode=signup#token=${token}`} className="mk-btn-light">
                  Create invited account
                </Link>
              </div>
            </>
          )}
        </main>
        <LegalLinks className="mt-4" />
      </div>
    </div>
  );
}
