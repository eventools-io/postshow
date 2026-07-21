import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/state/WorkspaceContext';
import { fetchEngine, fetchInbox } from '@/lib/api';
import { Logo } from '@/components/Logo';

const NAV = [
  { to: '/inbox', label: 'Inbox', end: false },
  { to: '/accounts', label: 'Accounts', end: false },
  { to: '/field-notes', label: 'Field notes', end: false },
  { to: '/work-plan', label: 'Work plan', end: false },
  { to: '/connections', label: 'Connections', end: false },
  { to: '/settings', label: 'Settings', end: false },
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function WorkspacePicker({ compact = false }: { compact?: boolean }) {
  const { workspace, workspaces, selectWorkspace } = useWorkspace();
  if (!workspace) return null;
  if (workspaces.length <= 1) {
    return (
      <span
        className={
          compact
            ? 'max-w-[150px] truncate font-public-sans text-[12px] text-night-fg-2'
            : 'truncate font-public-sans text-[12px] text-night-fg-2'
        }
      >
        {workspace.name}
      </span>
    );
  }
  return (
    <label className={compact ? 'min-w-0 flex-1' : 'flex min-w-0 flex-col gap-1'}>
      <span
        className={
          compact
            ? 'sr-only'
            : 'font-public-mono text-[9px] uppercase tracking-[0.12em] text-night-fg-3'
        }
      >
        Workspace
      </span>
      <select
        value={workspace.id}
        onChange={(event) => selectWorkspace(event.target.value)}
        className={[
          'h-9 w-full min-w-0 rounded-sm border border-night-4 bg-night-1 px-2 font-public-sans text-[12px] text-night-fg focus:border-signal focus:outline-none',
          compact ? 'max-w-[190px]' : '',
        ].join(' ')}
      >
        {workspaces.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppShell() {
  const { workspace, workspaces, selectWorkspace, signOut } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingCount, setPendingCount] = useState(0);
  const [engineLine, setEngineLine] = useState('engine · not set');
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const checkoutReturn = searchParams.get('checkout');
  const billingReturn = searchParams.get('billing');
  const isProviderReturn =
    checkoutReturn === 'success' ||
    checkoutReturn === 'cancelled' ||
    billingReturn === 'return' ||
    billingReturn === 'payment-return';
  const returnWorkspaceValues = isProviderReturn ? searchParams.getAll('workspace') : [];
  const requestedReturnWorkspace =
    returnWorkspaceValues.length === 1 && UUID_RE.test(returnWorkspaceValues[0] ?? '')
      ? returnWorkspaceValues[0]!
      : null;
  const returnWorkspace = requestedReturnWorkspace
    ? (workspaces.find((candidate) => candidate.id === requestedReturnWorkspace) ?? null)
    : null;
  const mustScrubProviderReturn = isProviderReturn && !returnWorkspace;
  const mustSwitchProviderReturn = Boolean(returnWorkspace && workspace?.id !== returnWorkspace.id);

  useEffect(() => {
    if (mustSwitchProviderReturn && returnWorkspace) {
      if (selectWorkspace(returnWorkspace.id)) return;
    } else if (!mustScrubProviderReturn) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    next.delete('billing');
    next.delete('session_id');
    next.delete('workspace');
    setSearchParams(next, { replace: true });
  }, [
    mustScrubProviderReturn,
    mustSwitchProviderReturn,
    returnWorkspace,
    searchParams,
    selectWorkspace,
    setSearchParams,
  ]);

  async function handleSignOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    setSignOutError('');
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Sign out could not be completed.');
      setSignOutBusy(false);
    }
  }

  useEffect(() => {
    if (!workspace || mustScrubProviderReturn || mustSwitchProviderReturn) return;
    let cancelled = false;
    setPendingCount(0);
    setEngineLine('engine · checking');
    void fetchInbox(workspace.id)
      .then((items) => {
        if (!cancelled) setPendingCount(items.filter((i) => i.state === 'pending').length);
      })
      .catch(() => undefined);
    void fetchEngine(workspace.id)
      .then((engine) => {
        if (cancelled) return;
        if (!engine) {
          setEngineLine('engine · not set');
          return;
        }
        const label =
          engine.mode === 'hosted' ? 'hosted' : engine.mode === 'local' ? 'local' : 'your key';
        setEngineLine(`engine · ${label}`);
      })
      .catch(() => {
        if (!cancelled) setEngineLine('engine · unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [mustScrubProviderReturn, mustSwitchProviderReturn, workspace]);

  return (
    <div className="flex min-h-screen bg-night-0 text-night-fg">
      <aside className="fixed inset-y-0 left-0 hidden w-[220px] flex-col border-r border-night-3 bg-night-0 p-4 md:flex">
        <div className="flex items-baseline gap-2 px-2 pb-6">
          <span className="flex items-center gap-[8px] font-public-sans text-[16px] font-semibold tracking-[-0.02em]">
            <Logo size={22} />
            Postshow
          </span>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'flex items-center justify-between rounded-sm px-3 py-2 font-public-sans text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal',
                  isActive
                    ? 'bg-night-2 font-medium text-night-fg'
                    : 'text-night-fg-2 hover:text-night-fg',
                ].join(' ')
              }
            >
              {item.label}
              {item.label === 'Inbox' && pendingCount > 0 && (
                <span className="rounded-pill bg-signal px-[7px] py-[1px] font-public-mono text-[10px] font-semibold text-signal-ink">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-night-3 px-2 pt-4">
          <span className="font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
            {engineLine}
          </span>
          <WorkspacePicker />
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signOutBusy}
            className="w-fit rounded-sm font-public-sans text-[12px] text-night-fg-3 hover:text-night-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {signOutBusy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen w-full flex-col md:pl-[220px]">
        <div className="flex items-center gap-3 border-b border-night-3 px-4 py-3 md:hidden">
          <span className="flex shrink-0 items-center gap-2 font-public-sans text-[14px] font-semibold tracking-[-0.02em]">
            <Logo size={20} />
            <span className="sr-only sm:not-sr-only">Postshow</span>
          </span>
          <WorkspacePicker compact />
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signOutBusy}
            className="ml-auto shrink-0 rounded-sm font-public-sans text-[12px] text-night-fg-3 hover:text-night-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {signOutBusy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        {signOutError ? (
          <div
            className="border-b border-bad/40 bg-night-1 px-4 py-2 font-public-sans text-[12px] text-bad"
            role="alert"
          >
            {signOutError}
          </div>
        ) : null}
        <div className="flex gap-1 overflow-x-auto border-b border-night-3 px-3 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'shrink-0 rounded-sm px-3 py-2 font-public-sans text-[13px]',
                  isActive
                    ? 'bg-night-2 font-medium text-night-fg'
                    : 'text-night-fg-2 hover:text-night-fg',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <main
          key={workspace?.id}
          className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-8 md:px-8"
        >
          {mustScrubProviderReturn || mustSwitchProviderReturn ? (
            <p
              className="m-0 font-public-mono text-[11px] uppercase tracking-[0.12em] text-night-fg-3"
              role="status"
            >
              Verifying billing workspace…
            </p>
          ) : (
            <Outlet key={workspace?.id} />
          )}
        </main>
      </div>
    </div>
  );
}
