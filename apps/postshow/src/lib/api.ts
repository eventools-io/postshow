import { supabase } from './supabase';
import type {
  Workspace,
  WorkspaceMember,
  Entitlements,
  Connection,
  EngineSettings,
  EngineProvider,
  EngineTaskClass,
  EngineTaskPref,
  InboxItem,
  Account,
  FieldNote,
  Job,
  Run,
  Provider,
  UsageSummaryRow,
  ApiToken,
} from './types';

function throwing<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('empty response');
  return data;
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from('postshow_workspaces')
    .select('id, name, plan, agent_rules, created_at')
    .order('created_at', { ascending: true });
  return throwing(data, error);
}

export async function bootstrapWorkspace(name: string): Promise<Workspace> {
  const { data, error } = await supabase.rpc('postshow_bootstrap_workspace', { p_name: name });
  return throwing(data as Workspace | null, error);
}

export async function setAgentRules(workspaceId: string, rules: string[]): Promise<void> {
  const { error } = await supabase.rpc('postshow_set_agent_rules', {
    p_workspace: workspaceId,
    p_rules: rules,
  });
  if (error) throw new Error(error.message);
}

export async function fetchInbox(workspaceId: string): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('postshow_inbox_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(200);
  return throwing(data, error);
}

export async function skipInboxItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_resolve_inbox_item', {
    p_item: itemId,
    p_state: 'skipped',
  });
  if (error) throw new Error(error.message);
}

export async function updateInboxDraft(itemId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_update_inbox_draft', {
    p_item: itemId,
    p_body: body,
  });
  if (error) throw new Error(error.message);
}

export async function fetchAccounts(workspaceId: string): Promise<Account[]> {
  const { data, error } = await supabase
    .from('postshow_accounts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(500);
  return throwing(data, error);
}

export async function fetchFieldNotes(workspaceId: string): Promise<FieldNote[]> {
  const { data, error } = await supabase
    .from('postshow_field_notes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('state', 'dismissed')
    .order('sessions', { ascending: false })
    .limit(200);
  return throwing(data, error);
}

export async function draftTicketFromNote(noteId: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_draft_ticket_from_note', { p_note: noteId });
  if (error) throw new Error(error.message);
}

export async function fetchJobs(workspaceId: string): Promise<Job[]> {
  const { data, error } = await supabase
    .from('postshow_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('status', 'vetoed')
    .order('created_at', { ascending: true });
  return throwing(data, error);
}

export async function decideJob(
  jobId: string,
  action: 'approve' | 'veto' | 'pause' | 'resume'
): Promise<void> {
  const { error } = await supabase.rpc('postshow_decide_job', { p_job: jobId, p_action: action });
  if (error) throw new Error(error.message);
}

export async function fetchRuns(workspaceId: string): Promise<Run[]> {
  const { data, error } = await supabase
    .from('postshow_runs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('started_at', { ascending: false })
    .limit(30);
  return throwing(data, error);
}

export async function fetchConnections(workspaceId: string): Promise<Connection[]> {
  const { data, error } = await supabase
    .from('postshow_connections')
    .select(
      'id, workspace_id, provider, label, status, local_only, meta, last_checked_at, created_at'
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  return throwing(data, error);
}

export async function upsertConnection(input: {
  workspaceId: string;
  provider: Provider;
  label?: string;
  localOnly?: boolean;
  meta?: Record<string, unknown>;
  secret?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await supabase.rpc('postshow_upsert_connection', {
    p_workspace: input.workspaceId,
    p_provider: input.provider,
    p_label: input.label ?? '',
    p_local_only: input.localOnly ?? false,
    p_meta: input.meta ?? {},
    p_secret: input.secret ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteConnection(connectionId: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_delete_connection', {
    p_connection: connectionId,
  });
  if (error) throw new Error(error.message);
}

export async function fetchEngine(workspaceId: string): Promise<EngineSettings | null> {
  const { data, error } = await supabase
    .from('postshow_engine_settings')
    .select('workspace_id, mode, provider, model, base_url, task_prefs')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchKeyProviders(workspaceId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('postshow_engine_key_providers', {
    p_workspace: workspaceId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}

export async function setTaskPrefs(
  workspaceId: string,
  prefs: Partial<Record<EngineTaskClass, EngineTaskPref>>
): Promise<void> {
  const { error } = await supabase.rpc('postshow_set_task_prefs', {
    p_workspace: workspaceId,
    p_prefs: prefs,
  });
  if (error) throw new Error(error.message);
}

export async function setEngineKey(
  workspaceId: string,
  provider: EngineProvider,
  key: string
): Promise<void> {
  const { error } = await supabase.rpc('postshow_set_engine_key', {
    p_workspace: workspaceId,
    p_provider: provider,
    p_key: key,
  });
  if (error) throw new Error(error.message);
}

export async function fetchUsageSummary(workspaceId: string): Promise<UsageSummaryRow[]> {
  const { data, error } = await supabase.rpc('postshow_usage_summary', {
    p_workspace: workspaceId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as UsageSummaryRow[];
}

export async function fetchEntitlements(workspaceId: string): Promise<Entitlements | null> {
  const { data, error } = await supabase
    .from('postshow_entitlements')
    .select('workspace_id, sessions_watched, deep_dives, investigations, seats, metered')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase.rpc('postshow_list_members', {
    p_workspace: workspaceId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceMember[];
}

export async function addMember(workspaceId: string, email: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_add_member', {
    p_workspace: workspaceId,
    p_email: email,
  });
  if (error) throw new Error(error.message);
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_remove_member', {
    p_workspace: workspaceId,
    p_user: userId,
  });
  if (error) throw new Error(error.message);
}

export async function fetchApiTokens(workspaceId: string): Promise<ApiToken[]> {
  const { data, error } = await supabase
    .from('postshow_api_tokens')
    .select('id, workspace_id, name, token_prefix, created_at, last_used_at, revoked_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  return throwing(data, error);
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_revoke_api_token', { p_token: tokenId });
  if (error) throw new Error(error.message);
}

export async function createJob(input: {
  workspaceId: string;
  label: string;
  question?: string;
  intervalMinutes?: number;
  runtime?: 'cloud' | 'local';
}): Promise<void> {
  const { error } = await supabase.rpc('postshow_create_job', {
    p_workspace: input.workspaceId,
    p_label: input.label,
    p_question: input.question ?? '',
    p_interval_minutes: input.intervalMinutes ?? 1440,
    p_runtime: input.runtime ?? 'cloud',
  });
  if (error) throw new Error(error.message);
}

export async function updateJobCadence(
  jobId: string,
  intervalMinutes: number,
  runtime?: 'cloud' | 'local'
): Promise<void> {
  const { error } = await supabase.rpc('postshow_update_job_cadence', {
    p_job: jobId,
    p_interval_minutes: intervalMinutes,
    p_runtime: runtime ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function setEngine(input: {
  workspaceId: string;
  mode: EngineSettings['mode'];
  provider: EngineSettings['provider'];
  model?: string;
  baseUrl?: string;
  apiKey?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('postshow_set_engine', {
    p_workspace: input.workspaceId,
    p_mode: input.mode,
    p_provider: input.provider,
    p_model: input.model ?? '',
    p_base_url: input.baseUrl ?? '',
    p_api_key: input.apiKey ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Edge function calls (authenticated via the user's session JWT). */
async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(error.message);
  return data as T;
}

export function approveInboxItem(itemId: string): Promise<{ ok: boolean; detail: string }> {
  return invokeFunction('postshow-action', { item_id: itemId });
}

export function testConnection(connectionId: string): Promise<{ ok: boolean; detail: string }> {
  return invokeFunction('postshow-connection-test', { connection_id: connectionId });
}

export function runJobNow(
  jobId: string
): Promise<{ ok: boolean; run_id?: string; detail?: string }> {
  return invokeFunction('postshow-run', { job_id: jobId });
}

export function createApiToken(
  workspaceId: string,
  name: string
): Promise<{ ok: boolean; token?: string; token_prefix?: string; detail?: string }> {
  return invokeFunction('postshow-token', { workspace_id: workspaceId, name });
}

export function startCheckout(
  workspaceId: string,
  tier: 'solo' | 'team'
): Promise<{ ok: boolean; url?: string; detail?: string }> {
  return invokeFunction('postshow-checkout', {
    workspace_id: workspaceId,
    tier,
    return_url: `${window.location.origin}/settings`,
  });
}
