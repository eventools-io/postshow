import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { fetchWorkspaces, bootstrapWorkspace } from '@/lib/api';
import { identify, resetAnalyticsOnSignOut, track } from '@/lib/analytics';
import type { Workspace } from '@/lib/types';
import { recordPostshowLegalAcceptance } from '@/lib/legalAcceptance';

interface WorkspaceContextValue {
  session: Session | null;
  sessionLoading: boolean;
  sessionError: string;
  workspaces: Workspace[];
  workspace: Workspace | null;
  workspaceLoading: boolean;
  workspaceError: string;
  createWorkspace: (name: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => boolean;
  reloadSession: () => void;
  reloadWorkspace: (preferredWorkspaceId?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const SELECTED_WORKSPACE_KEY = 'postshow.selected-workspace-id';

function readSelectedWorkspaceId(): string | null {
  try {
    const value = window.localStorage.getItem(SELECTED_WORKSPACE_KEY);
    return value && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

function storeSelectedWorkspaceId(workspaceId: string | null): void {
  try {
    if (workspaceId) window.localStorage.setItem(SELECTED_WORKSPACE_KEY, workspaceId);
    else window.localStorage.removeItem(SELECTED_WORKSPACE_KEY);
  } catch {
    // Selection remains authoritative in memory for this renderer.
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [sessionNonce, setSessionNonce] = useState(0);
  const workspaceRequest = useRef(0);
  const selectedWorkspaceId = useRef<string | null>(null);
  const sessionUserId = useRef<string | null>(null);
  const analyticsUserId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let authEventObserved = false;
    setSessionLoading(true);
    setSessionError('');

    const applySession = (next: Session | null) => {
      const nextUserId = next?.user.id ?? null;
      if (analyticsUserId.current && analyticsUserId.current !== nextUserId) {
        resetAnalyticsOnSignOut();
        analyticsUserId.current = null;
      }
      if (sessionUserId.current !== nextUserId) {
        sessionUserId.current = nextUserId;
        workspaceRequest.current += 1;
        selectedWorkspaceId.current = readSelectedWorkspaceId();
        setWorkspaces([]);
        setWorkspace(null);
        setWorkspaceError('');
        setWorkspaceLoading(Boolean(nextUserId));
      }
      setSession(next);
    };

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        if (cancelled || authEventObserved) return;
        applySession(data.session);
      })
      .catch((error: unknown) => {
        if (cancelled || authEventObserved) return;
        applySession(null);
        setSessionError(
          error instanceof Error ? error.message : 'Your sign-in session could not be loaded.'
        );
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      authEventObserved = true;
      applySession(next);
      setSessionError('');
      setSessionLoading(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [sessionNonce]);

  const actorId = session?.user.id ?? null;
  const reloadWorkspace = useCallback(
    async (preferredWorkspaceId?: string) => {
      const request = ++workspaceRequest.current;
      if (!actorId) {
        setWorkspaces([]);
        setWorkspace(null);
        setWorkspaceError('');
        setWorkspaceLoading(false);
        return;
      }
      setWorkspaceLoading(true);
      setWorkspaceError('');
      if (preferredWorkspaceId) {
        selectedWorkspaceId.current = preferredWorkspaceId;
        storeSelectedWorkspaceId(preferredWorkspaceId);
      }
      try {
        const list = await fetchWorkspaces();
        if (request !== workspaceRequest.current || sessionUserId.current !== actorId) return;
        const preferred = selectedWorkspaceId.current;
        const next = list.find((candidate) => candidate.id === preferred) ?? list[0] ?? null;
        selectedWorkspaceId.current = next?.id ?? null;
        storeSelectedWorkspaceId(next?.id ?? null);
        setWorkspaces(list);
        setWorkspace(next);
      } catch (error) {
        if (request !== workspaceRequest.current || sessionUserId.current !== actorId) return;
        setWorkspaces([]);
        setWorkspace(null);
        setWorkspaceError(
          error instanceof Error ? error.message : 'Your workspace could not be loaded.'
        );
      } finally {
        if (request === workspaceRequest.current) setWorkspaceLoading(false);
      }
    },
    [actorId]
  );

  useEffect(() => {
    if (!actorId) {
      workspaceRequest.current += 1;
      setWorkspaces([]);
      setWorkspace(null);
      setWorkspaceError('');
      setWorkspaceLoading(false);
      return;
    }
    identify(actorId);
    analyticsUserId.current = actorId;
    void reloadWorkspace();
  }, [actorId, reloadWorkspace]);

  const createWorkspace = useCallback(async (name: string) => {
    const request = ++workspaceRequest.current;
    const creatingFor = sessionUserId.current;
    if (!creatingFor) throw new Error('Your sign-in session changed. Sign in and try again.');
    await recordPostshowLegalAcceptance('workspace_creation');
    if (request !== workspaceRequest.current || sessionUserId.current !== creatingFor) {
      throw new Error(
        'Your signed-in account changed before workspace creation. No workspace was created.'
      );
    }
    const created = await bootstrapWorkspace(name);
    if (request !== workspaceRequest.current || sessionUserId.current !== creatingFor) return;
    selectedWorkspaceId.current = created.id;
    storeSelectedWorkspaceId(created.id);
    setWorkspaces((current) => [
      ...current.filter((candidate) => candidate.id !== created.id),
      created,
    ]);
    setWorkspace(created);
    setWorkspaceError('');
    track('workspace_created');
  }, []);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      const next = workspaces.find((candidate) => candidate.id === workspaceId);
      if (!next) return false;
      if (workspace?.id !== next.id) workspaceRequest.current += 1;
      selectedWorkspaceId.current = next.id;
      storeSelectedWorkspaceId(next.id);
      setWorkspace(next);
      setWorkspaceError('');
      setWorkspaceLoading(false);
      return true;
    },
    [workspace?.id, workspaces]
  );

  const reloadSession = useCallback(() => setSessionNonce((nonce) => nonce + 1), []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    if (analyticsUserId.current) {
      resetAnalyticsOnSignOut();
      analyticsUserId.current = null;
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      sessionLoading,
      sessionError,
      workspaces,
      workspace,
      workspaceLoading,
      workspaceError,
      createWorkspace,
      selectWorkspace,
      reloadSession,
      reloadWorkspace,
      signOut,
    }),
    [
      session,
      sessionLoading,
      sessionError,
      workspaces,
      workspace,
      workspaceLoading,
      workspaceError,
      createWorkspace,
      selectWorkspace,
      reloadSession,
      reloadWorkspace,
      signOut,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook lives beside its provider
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside WorkspaceProvider');
  return ctx;
}
