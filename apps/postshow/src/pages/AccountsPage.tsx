import { useCallback, useState } from 'react';
import { useWorkspace } from '@/state/WorkspaceContext';
import { fetchAccounts } from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { PageHeader, EmptyState, LoadingRow, ErrorRow } from '@/components/page';
import type { Account } from '@/lib/types';

const TONE_CLASS = { good: 'bg-signal', warn: 'bg-warn', bad: 'bg-bad' } as const;

function formatMrr(cents: number | null): string {
  if (cents === null) return '';
  return `$${Math.round(cents / 100).toLocaleString()}/mo`;
}

function AccountRow({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-night-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-night-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={`inline-block h-[7px] w-[7px] shrink-0 rounded-pill ${TONE_CLASS[account.status_tone]}`}
            aria-hidden
          />
          <span className="truncate font-public-sans text-[14px] font-medium text-night-fg">
            {account.name}
          </span>
          {account.mrr_cents !== null && (
            <span className="shrink-0 font-public-mono text-[11px] text-night-fg-3">
              {formatMrr(account.mrr_cents)}
            </span>
          )}
        </span>
        <span className="shrink-0 font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
          {account.status}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-4 pb-4 pl-[34px]">
          {(account.facts ?? []).map((fact) => (
            <p key={fact} className="m-0 font-public-mono text-[11px] text-night-fg-3">
              {fact}
            </p>
          ))}
          {account.next_move && (
            <p className="m-0 max-w-[60ch] font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
              <span className="font-medium text-night-fg">Next move: </span>
              {account.next_move}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function AccountsPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchAccounts(workspaceId), [workspaceId]);
  const { data, loading, error } = usePageData(fetcher);
  const accounts = data ?? [];

  return (
    <div>
      <PageHeader
        title="Accounts"
        sub="One dossier per customer, kept current by the agent: trajectory, friction, revenue, and the next move."
      />
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && accounts.length === 0 && (
        <EmptyState
          title="No dossiers yet."
          body="Accounts appear as the agent watches sessions and reads your billing data. Connect PostHog and Stripe, run the session sweep, and your customer list builds itself."
          cta={{ label: 'Go to connections', to: '/connections' }}
        />
      )}
      {accounts.length > 0 && (
        <ul className="ps-card m-0 list-none overflow-hidden p-0">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </ul>
      )}
    </div>
  );
}
