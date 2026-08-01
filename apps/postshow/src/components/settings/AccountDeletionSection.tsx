import { useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Section } from '@/components/page';
import { supabase } from '@/lib/supabase';
import {
  accountDeletionReceiptFile,
  deletePostshowAccount,
  type AccountDeletionReceipt,
} from '@/lib/accountDeletion';
import { PostshowFunctionError } from '@/lib/functionClient';
import { destructiveAccessToken, REAUTHENTICATION_GUIDANCE } from '@/lib/destructiveAuth';
import { track } from '@/lib/analytics';

function downloadReceipt(receipt: AccountDeletionReceipt): void {
  const file = accountDeletionReceiptFile(receipt);
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = file.fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

function publicError(error: unknown): string {
  if (error instanceof PostshowFunctionError) {
    if (error.code === 'ownership_transfer_required') {
      return 'You still own at least one workspace. Transfer each workspace to another member or finish deleting it, then retry.';
    }
    if (error.code === 'reauthentication_required') {
      return REAUTHENTICATION_GUIDANCE;
    }
    if (error.code === 'account_deletion_unavailable') {
      return 'Account deletion is temporarily unavailable. Your account remains active; retry safely.';
    }
  }
  return error instanceof Error ? error.message : 'Account deletion could not be completed.';
}

export function AccountDeletionSection({ session }: { session: Session }) {
  const canonicalEmail = session.user.email?.trim().toLowerCase() ?? '';
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<AccountDeletionReceipt | null>(null);
  const accessToken = useRef('');

  const exactProof =
    canonicalEmail.length > 0 && email === canonicalEmail && confirmation === 'DELETE MY ACCOUNT';

  async function requestDeletion(reuseFreshToken = false) {
    if (busy || (!reuseFreshToken && !exactProof) || !canonicalEmail) return;
    setBusy(true);
    setError('');
    try {
      if (!reuseFreshToken) {
        accessToken.current = await destructiveAccessToken(session, password);
        setPassword('');
      }
      if (!accessToken.current) throw new Error('Fresh sign-in proof is missing.');
      const result = await deletePostshowAccount(canonicalEmail, accessToken.current);
      setReceipt(result);
      // Completion signal so self-serve deletion demand is finally measurable. No email,
      // token, or receipt id is attached: the taxonomy only needs the count of completions.
      track('account_deleted');
      downloadReceipt(result);
    } catch (value) {
      if (value instanceof PostshowFunctionError && value.code === 'reauthentication_required') {
        accessToken.current = '';
      }
      setError(publicError(value));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      window.location.assign('/');
    }
  }

  return (
    <Section title="Delete account">
      <div className="ps-card flex flex-col gap-3 p-4 sm:p-5">
        {!expanded ? (
          <>
            <p className="m-0 max-w-[68ch] font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
              Permanently delete your Postshow identity after you have transferred or deleted every
              workspace you own. Workspace deletion and account deletion are separate safeguards.
            </p>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="ps-btn-ghost w-fit text-bad"
            >
              Start account deletion
            </button>
          </>
        ) : receipt ? (
          <div role="status" aria-live="polite">
            <p className="m-0 font-public-sans text-[14px] font-semibold text-signal">
              Account deletion confirmed
            </p>
            <p className="m-0 mt-2 font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
              Your receipt downloaded automatically. Save it before leaving this page.
            </p>
            <code className="mt-2 block break-all font-public-mono text-[10px] text-night-fg-3">
              {receipt.request_id}
            </code>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadReceipt(receipt)}
                className="ps-btn-ghost"
              >
                Download receipt again
              </button>
              <button type="button" onClick={() => void finish()} className="ps-btn-primary">
                Finish and sign out
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-sm border border-bad/40 bg-night-2 p-3">
              <p className="m-0 font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
                This permanently deletes your individual Postshow sign-in account, removes all
                non-owner memberships, and revokes outstanding invitations for this email. It is
                blocked while you own any workspace—even one already being deleted.
              </p>
            </div>
            <label className="flex max-w-[420px] flex-col gap-1">
              <span className="font-public-sans text-[12px] text-night-fg-2">
                Confirm account email
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder={canonicalEmail}
                className="ps-input"
              />
            </label>
            <label className="flex max-w-[420px] flex-col gap-1">
              <span className="font-public-sans text-[12px] text-night-fg-2">
                Type DELETE MY ACCOUNT
              </span>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                className="ps-input"
              />
            </label>
            <label className="flex max-w-[420px] flex-col gap-1">
              <span className="font-public-sans text-[12px] text-night-fg-2">
                Password (optional with a fresh passwordless, OAuth, SSO, or MFA sign-in)
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="ps-input"
              />
              <span className="font-public-sans text-[11px] leading-[1.45] text-night-fg-3">
                Leave this blank to use your current interactive sign-in. The server accepts it only
                when its verified sign-in method is no more than 10 minutes old.
              </span>
            </label>
            {error ? (
              <div className="flex flex-col gap-2" role="alert">
                <p className="m-0 font-public-sans text-[12px] text-bad">{error}</p>
                {accessToken.current ? (
                  <button
                    type="button"
                    onClick={() => void requestDeletion(true)}
                    disabled={busy}
                    className="ps-btn-ghost w-fit"
                  >
                    Check deletion status safely
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void requestDeletion()}
                disabled={busy || !exactProof}
                className="ps-btn-primary bg-bad text-white"
              >
                {busy ? 'Verifying and deleting…' : 'Permanently delete account'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  setEmail('');
                  setConfirmation('');
                  setPassword('');
                  setError('');
                  accessToken.current = '';
                }}
                disabled={busy}
                className="ps-btn-ghost"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
