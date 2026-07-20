import { NavLink, Outlet } from 'react-router-dom';
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

export function AppShell() {
  const { workspace, signOut } = useWorkspace();
  const [pendingCount, setPendingCount] = useState(0);
  const [engineLine, setEngineLine] = useState('engine · not set');

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void fetchInbox(workspace.id)
      .then((items) => {
        if (!cancelled) setPendingCount(items.filter((i) => i.state === 'pending').length);
      })
      .catch(() => undefined);
    void fetchEngine(workspace.id)
      .then((engine) => {
        if (cancelled || !engine) return;
        const label =
          engine.mode === 'hosted' ? 'hosted' : engine.mode === 'local' ? 'local' : 'your key';
        setEngineLine(`engine · ${label}`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspace]);

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
          <span className="truncate font-public-sans text-[12px] text-night-fg-2">
            {workspace?.name}
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-fit rounded-sm font-public-sans text-[12px] text-night-fg-3 hover:text-night-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen w-full flex-col md:pl-[220px]">
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
        <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
