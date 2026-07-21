import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PLANS, normalizePlanId } from '@eventools/postshow-core';
import { ErrorRow, Section } from '@/components/page';
import {
  createInvitation,
  fetchEntitlements,
  fetchInvitations,
  fetchMembers,
  removeMember,
  revokeInvitation,
  setMemberRole,
  transferWorkspaceOwnership,
} from '@/lib/api';
import { track } from '@/lib/analytics';
import { PostshowFunctionError } from '@/lib/functionClient';
import { clearIdempotencyKey, idempotencyKey } from '@/lib/idempotency';
import type {
  InvitationDeliveryResult,
  InvitationRole,
  InvitationState,
  WorkspaceInvitation,
  WorkspaceMember,
} from '@/lib/types';
import { usePageData } from '@/lib/usePageData';

type AssignableRole = 'admin' | 'member' | 'viewer';

const DAY_MS = 24 * 60 * 60 * 1_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function utcDateFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

function expiryTimestamp(date: string): string | null {
  const timestamp = `${date}T23:59:59.000Z`;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function invitationState(invitation: WorkspaceInvitation, now = Date.now()): InvitationState {
  if (invitation.accepted_at) return 'accepted';
  if (invitation.revoked_at) return 'revoked';
  if (Date.parse(invitation.expires_at) <= now) return 'expired';
  return 'active';
}

function stateLabel(state: InvitationState): string {
  switch (state) {
    case 'active':
      return 'Active · reserves a seat';
    case 'accepted':
      return 'Accepted';
    case 'revoked':
      return 'Revoked';
    case 'expired':
      return 'Expired';
  }
}

function publicInvitationError(value: unknown): string {
  if (value instanceof PostshowFunctionError) {
    if (value.code === 'seat_limit_reached') {
      return 'The workspace seat limit is reached. Remove a member, revoke an active invitation, or add seats before retrying.';
    }
    if (value.code === 'not_authorized' || value.code === 'authentication_required') {
      return 'You no longer have permission to invite members. Refresh the workspace and check your role.';
    }
    if (value.code === 'invitation_conflict') {
      return 'That email already has an active invitation or workspace membership. Refresh the invitation list before trying again.';
    }
    if (value.code === 'invalid_request') {
      return 'The invitation details are no longer valid. Check the email, role, and expiration date.';
    }
    if (value.code === 'invitation_delivery_not_released') {
      return 'Invitation delivery is not available yet. No invitation was created.';
    }
  }
  return 'We could not confirm invitation delivery. Retry this exact invitation to safely recover the existing request.';
}

async function invitationRequestScope(input: {
  workspaceId: string;
  email: string;
  role: InvitationRole;
  expiresAt: string;
}): Promise<string> {
  const payload = [input.workspaceId, input.email, input.role, input.expiresAt].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `invitation:${fingerprint}`;
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function MemberManagementSection({
  workspaceId,
  planId,
  actorId,
}: {
  workspaceId: string;
  planId: string;
  actorId: string;
}) {
  const fetcher = useCallback(() => fetchMembers(workspaceId), [workspaceId]);
  const {
    data: members,
    loading: memberLoading,
    error: memberError,
    reload,
  } = usePageData(fetcher);
  const entitlementsFetcher = useCallback(() => fetchEntitlements(workspaceId), [workspaceId]);
  const {
    data: entitlementRow,
    loading: entitlementLoading,
    error: entitlementError,
  } = usePageData(entitlementsFetcher);
  const invitationsFetcher = useCallback(() => fetchInvitations(workspaceId), [workspaceId]);
  const {
    data: invitations,
    loading: invitationLoading,
    error: invitationError,
    reload: reloadInvitations,
  } = usePageData(invitationsFetcher);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [removeCandidate, setRemoveCandidate] = useState<WorkspaceMember | null>(null);
  const [transferCandidate, setTransferCandidate] = useState<WorkspaceMember | null>(null);
  const [transferProof, setTransferProof] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitationRole>('member');
  const [expiryDate, setExpiryDate] = useState(() => utcDateFromNow(7));
  const [inviteResult, setInviteResult] = useState<InvitationDeliveryResult | null>(null);
  const [inviteScope, setInviteScope] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [revokeCandidate, setRevokeCandidate] = useState<WorkspaceInvitation | null>(null);

  useEffect(() => {
    setBusy('');
    setError('');
    setRemoveCandidate(null);
    setTransferCandidate(null);
    setTransferProof('');
    setInviteEmail('');
    setInviteRole('member');
    setExpiryDate(utcDateFromNow(7));
    setInviteResult(null);
    setInviteScope('');
    setCopyNotice('');
    setRevokeCandidate(null);
  }, [workspaceId]);

  const plan = PLANS[normalizePlanId(planId)];
  const seats = entitlementRow?.seats ?? plan.seats;
  const actor = members?.find((member) => member.user_id === actorId) ?? null;
  const canManageInvitations = actor?.role === 'owner' || actor?.role === 'admin';
  const activeInvitations = (invitations ?? []).filter(
    (invitation) => invitationState(invitation) === 'active'
  );
  const used = (members ?? []).length + activeInvitations.length;
  const capacityReady = !entitlementLoading && !entitlementError;
  const inventoryReady = !invitationLoading && !invitationError;
  const seatLimitReached = used >= seats;
  const minExpiry = utcDateFromNow(1);
  const maxExpiry = utcDateFromNow(29);

  useEffect(() => {
    if (actor?.role !== 'owner' && inviteRole === 'admin') setInviteRole('member');
  }, [actor?.role, inviteRole]);

  function canManage(member: WorkspaceMember): boolean {
    if (!actor || member.role === 'owner' || member.user_id === actorId) return false;
    if (actor.role === 'owner') return true;
    return actor.role === 'admin' && member.role !== 'admin';
  }

  function canRevoke(candidate: WorkspaceInvitation): boolean {
    if (invitationState(candidate) !== 'active') return false;
    if (actor?.role === 'owner') return true;
    return actor?.role === 'admin' && candidate.role !== 'admin';
  }

  async function changeRole(member: WorkspaceMember, role: AssignableRole) {
    if (busy || member.role === role || !canManage(member)) return;
    setBusy(`role:${member.user_id}`);
    setError('');
    try {
      await setMemberRole(workspaceId, member.user_id, role);
      track('member_role_changed', { role });
      reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'The member role could not be changed.');
    } finally {
      setBusy('');
    }
  }

  async function confirmRemoval() {
    if (!removeCandidate || busy) return;
    setBusy(`remove:${removeCandidate.user_id}`);
    setError('');
    try {
      await removeMember(workspaceId, removeCandidate.user_id);
      track('member_removed', {});
      setRemoveCandidate(null);
      reload();
      reloadInvitations();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'The member could not be removed.');
    } finally {
      setBusy('');
    }
  }

  async function confirmTransfer() {
    if (
      !transferCandidate ||
      busy ||
      transferProof !== `TRANSFER TO ${transferCandidate.email}` ||
      actor?.role !== 'owner'
    ) {
      return;
    }
    setBusy(`transfer:${transferCandidate.user_id}`);
    setError('');
    try {
      await transferWorkspaceOwnership(workspaceId, transferCandidate.user_id);
      track('workspace_ownership_transferred', {});
      setTransferCandidate(null);
      setTransferProof('');
      reload();
      reloadInvitations();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Ownership could not be transferred.');
    } finally {
      setBusy('');
    }
  }

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canManageInvitations) return;
    setError('');
    setCopyNotice('');
    const email = inviteEmail.trim().toLowerCase();
    const expiresAt = expiryTimestamp(expiryDate);
    const expiryMs = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!EMAIL_RE.test(email) || email.length > 320) {
      setError('Enter a valid invitation email address.');
      return;
    }
    if (
      !expiresAt ||
      !Number.isFinite(expiryMs) ||
      expiryMs <= Date.now() ||
      expiryMs > Date.now() + 30 * DAY_MS
    ) {
      setError('Choose an expiration date within the next 30 days.');
      return;
    }
    if (!capacityReady || !inventoryReady) {
      setError('Seat availability could not be confirmed. Refresh the invitation list and retry.');
      return;
    }
    if (plan.id === 'free' || seatLimitReached) {
      setError(
        'The workspace seat limit is reached. Remove a member, revoke an active invitation, or add seats before retrying.'
      );
      return;
    }
    if (actor?.role === 'admin' && inviteRole === 'admin') {
      setError('Only the workspace owner can invite another administrator.');
      return;
    }

    setBusy('invite');
    try {
      const scope = await invitationRequestScope({
        workspaceId,
        email,
        role: inviteRole,
        expiresAt,
      });
      setInviteScope(scope);
      const result = await createInvitation({
        requestId: idempotencyKey(scope),
        workspaceId,
        email,
        role: inviteRole,
        expiresAt,
      });
      setInviteResult(result);
      reloadInvitations();
    } catch (value) {
      setError(publicInvitationError(value));
    } finally {
      setBusy('');
    }
  }

  async function copyInvitationLink() {
    if (!inviteResult || busy) return;
    setBusy('copy-invitation');
    setCopyNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(inviteResult.link);
      setCopyNotice('Invitation link copied.');
    } catch {
      setCopyNotice('Automatic copy is unavailable. Select and copy the invitation link manually.');
    } finally {
      setBusy('');
    }
  }

  function startAnotherInvitation() {
    if (busy) return;
    if (inviteScope) clearIdempotencyKey(inviteScope);
    setInviteResult(null);
    setInviteScope('');
    setInviteEmail('');
    setInviteRole('member');
    setExpiryDate(utcDateFromNow(7));
    setCopyNotice('');
    setError('');
  }

  async function confirmRevoke() {
    if (!revokeCandidate || busy || !canRevoke(revokeCandidate)) return;
    setBusy(`revoke:${revokeCandidate.id}`);
    setError('');
    try {
      await revokeInvitation(revokeCandidate.id);
      setRevokeCandidate(null);
      reloadInvitations();
    } catch {
      setError('The invitation could not be revoked. Refresh the list and check your role.');
    } finally {
      setBusy('');
    }
  }

  return (
    <Section title="Members">
      <div className="ps-card flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="m-0 font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
            {plan.id === 'free'
              ? 'The free plan is single-member. Upgrade when you are ready to add teammates.'
              : 'Owners and administrators manage access. Only the current owner can transfer ownership or manage administrators.'}
          </p>
          <span className="shrink-0 font-public-mono text-[11px] text-night-fg-3">
            {used} / {seats} seat{seats === 1 ? '' : 's'}
          </span>
        </div>

        {memberError ? <ErrorRow message={memberError} /> : null}
        {entitlementError ? <ErrorRow message={entitlementError} /> : null}
        {memberLoading ? (
          <p className="m-0 font-public-sans text-[12px] text-night-fg-3" role="status">
            Loading members…
          </p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(members ?? []).map((member) => (
            <li
              key={member.user_id}
              className="flex flex-col gap-2 border-t border-night-4 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <span className="block truncate font-public-sans text-[13px] text-night-fg">
                  {member.email}
                  {member.user_id === actorId ? ' (you)' : ''}
                </span>
                <span className="font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3 sm:hidden">
                  {member.role}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManage(member) ? (
                  <select
                    value={member.role}
                    onChange={(event) =>
                      void changeRole(member, event.target.value as AssignableRole)
                    }
                    disabled={busy !== ''}
                    aria-label={`Role for ${member.email}`}
                    className="ps-input min-w-[120px] py-1.5"
                  >
                    {actor?.role === 'owner' ? <option value="admin">Admin</option> : null}
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <span className="hidden font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3 sm:inline">
                    {member.role}
                  </span>
                )}
                {actor?.role === 'owner' && member.role !== 'owner' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTransferCandidate(member);
                      setTransferProof('');
                      setRemoveCandidate(null);
                    }}
                    disabled={busy !== ''}
                    className="ps-btn-ghost"
                  >
                    Transfer ownership
                  </button>
                ) : null}
                {canManage(member) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRemoveCandidate(member);
                      setTransferCandidate(null);
                    }}
                    disabled={busy !== ''}
                    className="ps-btn-ghost text-bad"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {removeCandidate ? (
          <div className="rounded-sm border border-bad/40 bg-night-2 p-3" role="alertdialog">
            <p className="m-0 font-public-sans text-[12px] text-night-fg-2">
              Remove <strong className="text-night-fg">{removeCandidate.email}</strong>? Their API
              tokens for this workspace will be revoked.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmRemoval()}
                disabled={busy !== ''}
                className="ps-btn-primary"
              >
                Confirm removal
              </button>
              <button
                type="button"
                onClick={() => setRemoveCandidate(null)}
                disabled={busy !== ''}
                className="ps-btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {transferCandidate ? (
          <div className="rounded-sm border border-bad/40 bg-night-2 p-3" role="alertdialog">
            <p className="m-0 font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
              Ownership transfers immediately to {transferCandidate.email}. You become an
              administrator. Type{' '}
              <code className="font-public-mono text-night-fg">
                TRANSFER TO {transferCandidate.email}
              </code>{' '}
              to confirm.
            </p>
            <input
              value={transferProof}
              onChange={(event) => setTransferProof(event.target.value)}
              autoComplete="off"
              aria-label="Ownership transfer confirmation"
              className="ps-input mt-3 max-w-[480px]"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmTransfer()}
                disabled={busy !== '' || transferProof !== `TRANSFER TO ${transferCandidate.email}`}
                className="ps-btn-primary"
              >
                Confirm ownership transfer
              </button>
              <button
                type="button"
                onClick={() => {
                  setTransferCandidate(null);
                  setTransferProof('');
                }}
                disabled={busy !== ''}
                className="ps-btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {canManageInvitations ? (
          <section
            className="mt-2 border-t border-night-4 pt-4"
            aria-labelledby="invitations-title"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3
                  id="invitations-title"
                  className="m-0 font-public-sans text-[14px] font-medium text-night-fg"
                >
                  Invitations
                </h3>
                <p className="m-0 mt-1 font-public-sans text-[12px] leading-[1.5] text-night-fg-2">
                  Active invitations reserve seats. Links expire automatically and stop working
                  immediately when revoked.
                </p>
              </div>
              <span className="font-public-mono text-[10px] uppercase tracking-[0.1em] text-night-fg-3">
                {activeInvitations.length} active
              </span>
            </div>

            {invitationError ? (
              <div className="mt-3">
                <ErrorRow message={invitationError} />
              </div>
            ) : null}

            {inviteResult ? (
              <div
                className="mt-4 rounded-sm border border-night-4 bg-night-2 p-3"
                role={inviteResult.delivery_state === 'failed' ? 'alert' : 'status'}
                aria-live="polite"
              >
                <p
                  className={`m-0 font-public-sans text-[13px] font-medium ${
                    inviteResult.delivery_state === 'delivered' ? 'text-signal' : 'text-warn'
                  }`}
                >
                  {inviteResult.delivery_state === 'delivered'
                    ? 'Invitation email delivered'
                    : 'Email delivery failed — share the link manually'}
                </p>
                <p className="m-0 mt-1 font-public-sans text-[12px] leading-[1.5] text-night-fg-2">
                  {inviteResult.delivery_state === 'delivered'
                    ? `The invitation to ${inviteEmail.trim().toLowerCase()} is active until ${formatDate(inviteResult.expires_at)}.`
                    : `The invitation is active until ${formatDate(inviteResult.expires_at)}, but the email provider did not confirm delivery.`}
                </p>
                <label className="mt-3 flex flex-col gap-1">
                  <span className="ps-label">Invitation link</span>
                  <input
                    readOnly
                    value={inviteResult.link}
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label="Invitation link"
                    autoComplete="off"
                    className="ps-input font-public-mono text-[11px]"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copyInvitationLink()}
                    disabled={busy !== ''}
                    className="ps-btn-primary"
                  >
                    {busy === 'copy-invitation' ? 'Copying…' : 'Copy invitation link'}
                  </button>
                  <button
                    type="button"
                    onClick={startAnotherInvitation}
                    disabled={busy !== ''}
                    className="ps-btn-ghost"
                  >
                    Invite another person
                  </button>
                </div>
                {copyNotice ? (
                  <p
                    className="m-0 mt-2 font-public-sans text-[12px] text-night-fg-2"
                    role="status"
                  >
                    {copyNotice}
                  </p>
                ) : null}
              </div>
            ) : plan.id === 'free' ? (
              <p className="m-0 mt-4 rounded-sm border border-night-4 bg-night-2 p-3 font-public-sans text-[12px] text-night-fg-2">
                Upgrade to a multi-seat plan before sending invitations.
              </p>
            ) : entitlementLoading || invitationLoading ? (
              <p className="m-0 mt-4 font-public-sans text-[12px] text-night-fg-3" role="status">
                Checking invitation capacity…
              </p>
            ) : seatLimitReached ? (
              <p
                className="m-0 mt-4 rounded-sm border border-warn/40 bg-night-2 p-3 font-public-sans text-[12px] text-night-fg-2"
                role="status"
              >
                Every seat is assigned or reserved. Remove a member, revoke an active invitation, or
                add seats before inviting someone else.
              </p>
            ) : capacityReady && inventoryReady ? (
              <form onSubmit={(event) => void sendInvitation(event)} className="mt-4 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_170px]">
                  <label className="flex flex-col gap-1">
                    <span className="ps-label">Email</span>
                    <input
                      type="email"
                      required
                      maxLength={320}
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      autoComplete="email"
                      placeholder="teammate@company.com"
                      className="ps-input"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="ps-label">Role</span>
                    <select
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value as InvitationRole)}
                      className="ps-input"
                      aria-label="Invitation role"
                    >
                      {actor?.role === 'owner' ? <option value="admin">Admin</option> : null}
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="ps-label">Expires (UTC)</span>
                    <input
                      type="date"
                      required
                      min={minExpiry}
                      max={maxExpiry}
                      value={expiryDate}
                      onChange={(event) => setExpiryDate(event.target.value)}
                      className="ps-input"
                    />
                  </label>
                </div>
                <button type="submit" disabled={busy !== ''} className="ps-btn-primary w-fit">
                  {busy === 'invite' ? 'Sending invitation…' : 'Send invitation'}
                </button>
              </form>
            ) : null}

            <div className="mt-5 border-t border-night-4 pt-4">
              <h4 className="m-0 font-public-sans text-[12px] font-medium text-night-fg">
                Invitation history
              </h4>
              {invitationLoading ? (
                <p className="m-0 mt-2 font-public-sans text-[12px] text-night-fg-3" role="status">
                  Loading invitations…
                </p>
              ) : (invitations ?? []).length === 0 && !invitationError ? (
                <p className="m-0 mt-2 font-public-sans text-[12px] text-night-fg-3">
                  No invitations yet.
                </p>
              ) : (
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {(invitations ?? []).map((invitation) => {
                    const state = invitationState(invitation);
                    return (
                      <li
                        key={invitation.id}
                        className="flex flex-col gap-2 border-t border-night-4 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <span className="block truncate font-public-sans text-[13px] text-night-fg">
                            {invitation.email}
                          </span>
                          <span className="font-public-mono text-[10px] uppercase tracking-[0.08em] text-night-fg-3">
                            {invitation.role} · {stateLabel(state)} · expires{' '}
                            {formatDate(invitation.expires_at)}
                          </span>
                        </div>
                        {canRevoke(invitation) ? (
                          <button
                            type="button"
                            onClick={() => setRevokeCandidate(invitation)}
                            disabled={busy !== ''}
                            className="ps-btn-ghost text-bad"
                          >
                            Revoke
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {revokeCandidate ? (
              <div
                className="mt-4 rounded-sm border border-bad/40 bg-night-2 p-3"
                role="alertdialog"
                aria-labelledby="revoke-invitation-title"
              >
                <p
                  id="revoke-invitation-title"
                  className="m-0 font-public-sans text-[12px] leading-[1.55] text-night-fg-2"
                >
                  Revoke the invitation for{' '}
                  <strong className="text-night-fg">{revokeCandidate.email}</strong>? Its link will
                  stop working immediately and the reserved seat will be released.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void confirmRevoke()}
                    disabled={busy !== ''}
                    className="ps-btn-primary bg-bad text-white"
                  >
                    {busy === `revoke:${revokeCandidate.id}` ? 'Revoking…' : 'Confirm revoke'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRevokeCandidate(null)}
                    disabled={busy !== ''}
                    className="ps-btn-ghost"
                  >
                    Keep invitation
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? <ErrorRow message={error} /> : null}
      </div>
    </Section>
  );
}
