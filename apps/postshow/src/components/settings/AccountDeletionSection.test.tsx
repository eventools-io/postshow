import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { AccountDeletionSection } from './AccountDeletionSection';
import { deletePostshowAccount } from '@/lib/accountDeletion';
import { PostshowFunctionError } from '@/lib/functionClient';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('@/lib/accountDeletion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/accountDeletion')>();
  return { ...actual, deletePostshowAccount: vi.fn() };
});

const remove = vi.fn();
const click = vi.fn();
const createElement = document.createElement.bind(document);
const deleteAccount = vi.mocked(deletePostshowAccount);
const session = {
  access_token: 'old-jwt',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'person@example.com' },
} as Session;

async function fillProof(user: ReturnType<typeof userEvent.setup>, withPassword = true) {
  await user.click(screen.getByRole('button', { name: /start account deletion/i }));
  await user.type(screen.getByLabelText(/confirm account email/i), 'person@example.com');
  await user.type(screen.getByLabelText(/type delete my account/i), 'DELETE MY ACCOUNT');
  if (withPassword) {
    await user.type(screen.getByLabelText(/password.*optional/i), 'fresh-password');
  }
}

describe('AccountDeletionSection', () => {
  beforeEach(() => {
    auth.signInWithPassword.mockReset().mockResolvedValue({
      data: {
        session: {
          ...session,
          access_token: 'fresh-jwt',
        },
      },
      error: null,
    });
    auth.signOut.mockReset().mockResolvedValue({ error: null });
    deleteAccount.mockReset();
    click.mockReset();
    remove.mockReset();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:receipt'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'a') {
        return {
          href: '',
          download: '',
          rel: '',
          click,
          remove,
        } as unknown as ReturnType<typeof document.createElement>;
      }
      return createElement(tagName);
    }) as typeof document.createElement);
    vi.spyOn(document.body, 'append').mockImplementation(() => undefined);
  });

  it('describes deletion as affecting the signed-in individual account', async () => {
    const user = userEvent.setup();
    render(<AccountDeletionSection session={session} />);

    await user.click(screen.getByRole('button', { name: /start account deletion/i }));

    expect(screen.getByText(/your individual Postshow sign-in account/i)).toBeInTheDocument();
    expect(screen.queryByText(/shared Postshow sign-in account/i)).not.toBeInTheDocument();
  });

  it('reauthenticates immediately, deletes with the fresh token, and downloads the receipt', async () => {
    deleteAccount.mockResolvedValue({
      request_id: '00000000-0000-4000-8000-000000000004',
      deleted_at: '2026-07-21T20:00:01.000Z',
    });
    const user = userEvent.setup();
    render(<AccountDeletionSection session={session} />);
    await fillProof(user);
    await user.click(screen.getByRole('button', { name: /permanently delete account/i }));

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'person@example.com',
        password: 'fresh-password',
      })
    );
    expect(deleteAccount).toHaveBeenCalledWith('person@example.com', 'fresh-jwt');
    expect(await screen.findByText(/account deletion confirmed/i)).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('uses a current fresh non-password session without forcing a password sign-in', async () => {
    deleteAccount.mockResolvedValue({
      request_id: '00000000-0000-4000-8000-000000000004',
      deleted_at: '2026-07-21T20:00:01.000Z',
    });
    const user = userEvent.setup();
    render(<AccountDeletionSection session={session} />);
    await fillProof(user, false);
    await user.click(screen.getByRole('button', { name: /permanently delete account/i }));

    expect(await screen.findByText(/account deletion confirmed/i)).toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(deleteAccount).toHaveBeenCalledWith('person@example.com', 'old-jwt');
  });

  it('guides a stale passwordless session through its normal sign-in method', async () => {
    deleteAccount.mockRejectedValue(
      new PostshowFunctionError('provider detail', 'reauthentication_required', 401)
    );
    const user = userEvent.setup();
    render(<AccountDeletionSection session={session} />);
    await fillProof(user, false);
    await user.click(screen.getByRole('button', { name: /permanently delete account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign out and sign in again/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/OAuth.*magic link.*SSO.*MFA/i);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /check deletion status safely/i })
    ).not.toBeInTheDocument();
  });

  it('explains the ownership invariant without deleting the account', async () => {
    deleteAccount.mockRejectedValue(
      new PostshowFunctionError('provider detail', 'ownership_transfer_required', 409)
    );
    const user = userEvent.setup();
    render(<AccountDeletionSection session={session} />);
    await fillProof(user);
    await user.click(screen.getByRole('button', { name: /permanently delete account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/transfer each workspace/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/provider detail/i);
  });

  it('reuses the same fresh token for authoritative lost-response readback', async () => {
    deleteAccount.mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce({
      request_id: '00000000-0000-4000-8000-000000000004',
      deleted_at: '2026-07-21T20:00:01.000Z',
    });
    const user = userEvent.setup();
    render(<AccountDeletionSection session={session} />);
    await fillProof(user);
    await user.click(screen.getByRole('button', { name: /permanently delete account/i }));
    await user.click(await screen.findByRole('button', { name: /check deletion status safely/i }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(2));
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(deleteAccount).toHaveBeenNthCalledWith(2, 'person@example.com', 'fresh-jwt');
  });
});
