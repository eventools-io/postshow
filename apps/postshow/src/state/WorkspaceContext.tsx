import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { fetchWorkspaces, bootstrapWorkspace } from '@/lib/api';
import { identify, track } from '@/lib/analytics';
import type { Workspace } from '@/lib/types';

interface WorkspaceContextValue {
  session: Session | null;
  sessionLoading: boolean;
  workspace: Workspace | null;
  workspaceLoading: boolean;
  createWorkspace: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setWorkspace(null);
      return;
    }
    identify(session.user.id, { email: session.user.email });
    let cancelled = false;
    setWorkspaceLoading(true);
    void fetchWorkspaces()
      .then((list) => {
        if (cancelled) return;
        setWorkspace(list[0] ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspace(null);
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const createWorkspace = useCallback(async (name: string) => {
    const created = await bootstrapWorkspace(name);
    setWorkspace(created);
    track('workspace_created');
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, sessionLoading, workspace, workspaceLoading, createWorkspace, signOut }),
    [session, sessionLoading, workspace, workspaceLoading, createWorkspace, signOut]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook lives beside its provider
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside WorkspaceProvider');
  return ctx;
}
