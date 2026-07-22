import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WaitlistForm } from './WaitlistForm';

const mocks = vi.hoisted(() => ({ joinWaitlist: vi.fn() }));

vi.mock('@/lib/waitlist', () => ({ joinWaitlist: mocks.joinWaitlist }));

describe('WaitlistForm', () => {
  beforeEach(() => mocks.joinWaitlist.mockReset().mockResolvedValue('joined'));

  it('submits an email with a replay-safe request identity', async () => {
    const user = userEvent.setup();
    render(<WaitlistForm />);
    await user.type(screen.getByLabelText(/email address/i), 'person@example.com');
    await user.click(screen.getByRole('button', { name: /apply for the beta/i }));

    await waitFor(() => expect(mocks.joinWaitlist).toHaveBeenCalledTimes(1));
    const [email, requestId] = mocks.joinWaitlist.mock.calls[0] as string[];
    expect(email).toBe('person@example.com');
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(await screen.findByText(/application received/i)).toBeInTheDocument();
  });

  it('keeps admission failures non-enumerating and retryable', async () => {
    mocks.joinWaitlist.mockResolvedValue('error');
    const user = userEvent.setup();
    render(<WaitlistForm />);
    await user.type(screen.getByLabelText(/email address/i), 'existing@example.com');
    await user.click(screen.getByRole('button', { name: /apply for the beta/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something broke on our end. Try again in a minute.'
    );
    expect(screen.queryByText(/already|exists|duplicate/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply for the beta/i })).toBeEnabled();
  });
});
