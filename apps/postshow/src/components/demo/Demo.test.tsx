import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Demo } from './Demo';

describe('Demo inbox', () => {
  it('reviews an incident and counts down to inbox zero with the beta cta', async () => {
    const user = userEvent.setup();
    render(<Demo />);

    expect(screen.getByText('3 drafts from last night')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /approve: expansion · lattice metrics/i }));
    expect(screen.getByText('2 drafts from last night')).toBeInTheDocument();
    expect(screen.getByText(/upgrade email sent/i)).toBeInTheDocument();
    expect(screen.getByText('1 approved')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /review incident: customer incident · onboarding/i })
    );
    expect(
      screen.getByRole('heading', {
        name: /seven trials stalled while connecting their first data source/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/no revenue impact is claimed yet/i)).toBeInTheDocument();
    expect(screen.getByText(/outcome is pending/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /approve both drafts/i }));
    await user.click(screen.getByRole('button', { name: /skip: churn risk · deployhub/i }));

    expect(screen.getByText(/inbox zero\. enjoy the coffee\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /apply for the closed beta/i })).toHaveAttribute(
      'href',
      '#waitlist'
    );

    await user.click(screen.getByRole('button', { name: /replay last night/i }));
    expect(screen.getByText('3 drafts from last night')).toBeInTheDocument();
  });
});

describe('Demo cross-tab flows', () => {
  it('drafts a ticket from field notes into the inbox', async () => {
    const user = userEvent.setup();
    render(<Demo />);

    await user.click(screen.getByRole('button', { name: 'Field notes' }));
    await user.click(
      screen.getByRole('button', { name: /draft ticket: nobody finds bulk import/i })
    );

    expect(screen.getByText('4 drafts from last night')).toBeInTheDocument();
    expect(screen.getByText(/ticket drafted from 23 watched sessions\./i)).toBeInTheDocument();
  });

  it('expands an account dossier and jumps to its draft', async () => {
    const user = userEvent.setup();
    render(<Demo />);

    await user.click(screen.getByRole('button', { name: 'Accounts' }));
    await user.click(screen.getByRole('button', { name: /deployhub/i }));
    expect(
      screen.getByText(/personal check-in, and ship the key-rotation fix first\./i)
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /draft waiting in inbox/i })[0]!);
    expect(screen.getByText('3 drafts from last night')).toBeInTheDocument();
  });

  it('approves the agent proposal into the schedule', async () => {
    const user = userEvent.setup();
    render(<Demo />);

    await user.click(screen.getByRole('button', { name: 'Work plan' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText(/approved by you/i)).toBeInTheDocument();
  });

  it('connects a source and switches the engine', async () => {
    const user = userEvent.setup();
    render(<Demo />);

    await user.click(screen.getByRole('button', { name: 'Connections' }));
    await user.click(screen.getByRole('button', { name: /connect sentry/i }));
    expect(screen.queryByRole('button', { name: /connect sentry/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Your key' }));
    expect(screen.getByText('engine · your key')).toBeInTheDocument();
  });

  it('plays the night log and jumps to the drafts', async () => {
    const user = userEvent.setup();
    render(<Demo />);

    await user.click(screen.getByRole('button', { name: 'Night log' }));
    expect(screen.getByText(/deep dive · opus 4\.8 · high/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /see the 3 drafts/i }));
    expect(screen.getByText('3 drafts from last night')).toBeInTheDocument();
  });
});
