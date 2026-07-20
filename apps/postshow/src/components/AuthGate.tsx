import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useWorkspace } from '@/state/WorkspaceContext';
import { Logo } from '@/components/Logo';

function WorkspaceScreen() {
  const { createWorkspace, signOut } = useWorkspace();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await createWorkspace(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the workspace.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-0 px-5">
      <div className="w-full max-w-[420px]">
        <span className="flex items-center gap-[10px] font-public-sans text-[18px] font-semibold tracking-[-0.02em] text-shell-fg">
          <Logo size={22} />
          Postshow
        </span>
        <div className="mt-6 rounded-lg border border-shell-3 bg-shell-1 p-7">
          <h1 className="m-0 font-public-sans text-[22px] font-semibold text-shell-fg">
            Name your workspace
          </h1>
          <p className="m-0 mt-1 font-public-sans text-[13px] leading-[1.5] text-shell-fg-2">
            Usually your company name. Connections, the inbox, and the work plan live here.
          </p>
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="mk-eyebrow text-shell-fg-3">Workspace name</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 w-full rounded-md border border-shell-3 bg-shell-0 px-3 font-public-sans text-[14px] text-shell-fg placeholder:text-shell-fg-3 focus:border-signal-deep focus:outline-none"
                placeholder="Acme Cloud"
              />
            </label>
            {error && (
              <p className="m-0 font-public-sans text-[13px] text-bad" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="mk-btn-dark mt-1 w-full">
              {busy ? 'Creating…' : 'Create workspace'}
            </button>
          </form>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 rounded-sm font-public-sans text-[13px] text-shell-fg-3 hover:text-shell-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

/** Gates the app cluster: unauthenticated → /signin; authenticated without a
 * workspace → workspace creation; otherwise the app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, sessionLoading, workspace, workspaceLoading } = useWorkspace();

  if (sessionLoading || (session && workspaceLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-shell-0">
        <span className="mk-eyebrow text-shell-fg-3">loading…</span>
      </div>
    );
  }
  if (!session) return <Navigate to="/signin" replace />;
  if (!workspace) return <WorkspaceScreen />;
  return <>{children}</>;
}
