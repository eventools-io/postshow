import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaitlistForm } from './WaitlistForm';

const mocks = vi.hoisted(() => ({
  joinWaitlist: vi.fn(),
  turnstileRender: vi.fn(),
  turnstileReset: vi.fn(),
  turnstileRemove: vi.fn(),
}));

vi.mock('@/lib/waitlist', () => ({ joinWaitlist: mocks.joinWaitlist }));

describe('WaitlistForm', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_POSTSHOW_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    vi.stubEnv('VITE_POSTSHOW_TURNSTILE_BYPASS', 'false');
    mocks.joinWaitlist.mockReset().mockResolvedValue('joined');
    mocks.turnstileRender.mockReset().mockReturnValue('waitlist-widget');
    mocks.turnstileReset.mockReset();
    mocks.turnstileRemove.mockReset();
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
        render: mocks.turnstileRender,
        reset: mocks.turnstileReset,
        remove: mocks.turnstileRemove,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function solve(token = 'single-use-waitlist-token') {
    await waitFor(() => expect(mocks.turnstileRender).toHaveBeenCalledTimes(1));
    const options = mocks.turnstileRender.mock.calls[0]?.[1] as {
      action: string;
      callback: (value: string) => void;
    };
    expect(options.action).toBe('postshow_waitlist_join');
    act(() => options.callback(token));
  }

  it('requires the dedicated Turnstile action and sends its token with a request identity', async () => {
    const user = userEvent.setup();
    render(<WaitlistForm />);
    const submit = screen.getByRole('button', { name: /join the waitlist/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/email address/i), 'person@example.com');
    await solve();
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(mocks.joinWaitlist).toHaveBeenCalledTimes(1));
    const [email, token, requestId] = mocks.joinWaitlist.mock.calls[0] as string[];
    expect(email).toBe('person@example.com');
    expect(token).toBe('single-use-waitlist-token');
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(await screen.findByText(/you.re on the list/i)).toBeInTheDocument();
  });

  it('resets a consumed challenge and keeps failures non-enumerating', async () => {
    mocks.joinWaitlist.mockResolvedValue('error');
    const user = userEvent.setup();
    render(<WaitlistForm />);
    await user.type(screen.getByLabelText(/email address/i), 'existing@example.com');
    await solve('consumed-token');
    await user.click(screen.getByRole('button', { name: /join the waitlist/i }));

    await waitFor(() => expect(mocks.turnstileReset).toHaveBeenCalledWith('waitlist-widget'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something broke on our end. Try again in a minute.'
    );
    expect(screen.queryByText(/already|exists|duplicate/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join the waitlist/i })).toBeDisabled();
  });
});
