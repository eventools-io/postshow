import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SignInPage } from './SignInPage';

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  fetchPublicReleaseGates: vi.fn(),
  workspace: {
    session: null as unknown,
    sessionLoading: false,
    sessionError: '',
    reloadSession: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
    },
  },
}));
vi.mock('@/state/WorkspaceContext', () => ({ useWorkspace: () => mocks.workspace }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), openAnalyticsPreferences: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  fetchPublicReleaseGates: mocks.fetchPublicReleaseGates,
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

describe('SignInPage recovery', () => {
  beforeEach(() => {
    mocks.workspace.session = null;
    mocks.workspace.sessionLoading = false;
    mocks.workspace.sessionError = '';
    mocks.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    mocks.updateUser.mockReset().mockResolvedValue({ error: null });
    mocks.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null });
    mocks.fetchPublicReleaseGates.mockReset().mockResolvedValue({
      signup: true,
      checkout: true,
      hosted_runtime: true,
      plan_changes: true,
      workspace_export: true,
      workspace_deletion: true,
    });
  });

  it('requests a single-use password recovery link', async () => {
    render(
      <MemoryRouter initialEntries={['/signin']}>
        <SignInPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /forgot your password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() =>
      expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com', {
        redirectTo: expect.stringMatching(/\/signin\?mode=update$/),
      })
    );
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });

  it('does not submit mismatched replacement passwords', async () => {
    mocks.workspace.session = { user: { id: 'user-id' } };
    render(
      <MemoryRouter initialEntries={['/signin?mode=update']}>
        <SignInPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'new-password-one' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'new-password-two' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('links signup acceptance to the authoritative Eventools terms', async () => {
    render(
      <MemoryRouter initialEntries={['/signin?mode=signup']}>
        <SignInPage />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('heading', { name: /create your account/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Terms' })[0]).toHaveAttribute('href', '/terms');
    expect(screen.getAllByRole('link', { name: /privacy/i })[0]).toHaveAttribute(
      'href',
      '/privacy'
    );
    expect(screen.getByRole('checkbox', { name: /I agree to Eventools LLC/i })).toBeRequired();
    expect(screen.getByText(/create a Postshow account/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/existing eventools logins|one account across/i);
  });

  it('signs in without a third-party challenge', async () => {
    render(
      <MemoryRouter initialEntries={['/signin']}>
        <SignInPage />
      </MemoryRouter>
    );
    const passwordInput = screen.getByLabelText(/^password$/i);
    expect(passwordInput).not.toHaveAttribute('minlength');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'legacy-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() =>
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: 'owner@example.com',
        password: 'legacy-password',
      })
    );
  });

  it('creates an account with legal proof and an explicit confirmation redirect', async () => {
    render(
      <MemoryRouter initialEntries={['/signin?mode=signup']}>
        <SignInPage />
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: /create your account/i });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'new-password-12' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Eventools LLC/i }));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(mocks.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'new-password-12',
        options: {
          data: {
            postshow_legal_acceptance: {
              terms_version: '2026-07-21',
              privacy_version: '2026-07-21',
              context: 'signup',
            },
          },
          emailRedirectTo: expect.stringMatching(/\/signin$/),
        },
      })
    );
  });

  it('allows only an invitation-linked signup while the public signup gate is closed', async () => {
    mocks.fetchPublicReleaseGates.mockResolvedValue({
      signup: false,
      checkout: false,
      hosted_runtime: false,
      plan_changes: false,
      workspace_export: false,
      workspace_deletion: false,
    });
    const token = `psi_${'a'.repeat(64)}`;
    render(
      <MemoryRouter
        initialEntries={[
          `/signin?mode=signup&token=${token}&invite=${token}&source=email#token=${token}`,
        ]}
      >
        <SignInPage />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('heading', { name: /create your account/i })
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent(token));
    expect(screen.getByTestId('location')).toHaveTextContent('/signin?mode=signup&source=email');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'invitee@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'invited-password-12' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to Eventools LLC/i }));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(mocks.signUp).toHaveBeenCalledWith({
        email: 'invitee@example.com',
        password: 'invited-password-12',
        options: {
          data: {
            postshow_legal_acceptance: {
              terms_version: '2026-07-21',
              privacy_version: '2026-07-21',
              context: 'signup',
            },
          },
          emailRedirectTo: expect.stringMatching(/\/invite$/),
        },
      })
    );
    expect(JSON.stringify(mocks.signUp.mock.calls)).not.toContain(token);
    expect(await screen.findByText(/reopen the original invitation link/i)).toBeInTheDocument();
  });

  it('requires 12 characters for new passwords and safely explains weak-password reasons', async () => {
    mocks.workspace.session = { user: { id: 'user-id' } };
    const weakPassword = Object.assign(new Error('provider detail'), {
      name: 'AuthWeakPasswordError',
      code: 'weak_password',
      reasons: ['length', 'pwned'],
    });
    mocks.updateUser.mockResolvedValue({ error: weakPassword });
    render(
      <MemoryRouter initialEntries={['/signin?mode=update']}>
        <SignInPage />
      </MemoryRouter>
    );

    const passwordInput = screen.getByLabelText(/^new password$/i);
    expect(passwordInput).toHaveAttribute('minlength', '12');
    fireEvent.change(passwordInput, { target: { value: 'twelve-chars!' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'twelve-chars!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/known breach data/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/provider detail/i);
  });
});
