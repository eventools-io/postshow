import { supabase } from './supabase';
import { invokePostshowFunction } from './functionClient';
import { posthogReplayConfig } from './replay';
import { parseIncidentEvidenceLedger } from './incidentEvidence';
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
  ApiTokenCreationResult,
  InvitationDeliveryResult,
  InvitationRole,
  WorkspaceInvitation,
  WorkspacePermissions,
  ActionType,
  CustomerIncident,
  IncidentDossier,
  IncidentAccount,
  PosthogReplayConfig,
  AccountIncidentLink,
} from './types';

function throwing<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('empty response');
  return data;
}

function customerIncident(value: unknown): CustomerIncident {
  const incident =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    ...incident,
    evidence_ledger: parseIncidentEvidenceLedger(incident.evidence_ledger),
  } as unknown as CustomerIncident;
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from('postshow_workspaces')
    .select('id, name, plan, agent_rules, created_at')
    .order('created_at', { ascending: true });
  return throwing(data, error);
}

export async function fetchWorkspacePermissions(
  workspaceId: string
): Promise<WorkspacePermissions> {
  const names = [
    'operate',
    'approve_actions',
    'manage_settings',
    'manage_members',
    'manage_billing',
    'delete_workspace',
  ] as const;
  const results = await Promise.all(
    names.map((permission) =>
      supabase.rpc('postshow_has_permission', {
        p_workspace: workspaceId,
        p_permission: permission,
      })
    )
  );
  const permissions = Object.fromEntries(
    results.map((result, index) => {
      if (result.error) throw new Error(result.error.message);
      if (typeof result.data !== 'boolean') {
        throw new Error('Workspace permissions could not be verified.');
      }
      return [names[index], result.data];
    })
  ) as Omit<WorkspacePermissions, 'workspace_id'>;
  return { workspace_id: workspaceId, ...permissions };
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

export async function skipInboxItem(itemId: string, expectedRevision: number): Promise<void> {
  const { error } = await supabase.rpc('postshow_skip_inbox_item', {
    p_item: itemId,
    p_expected_revision: expectedRevision,
  });
  if (error) throw new Error(error.message);
}

export async function updateInboxDraft(
  itemId: string,
  title: string,
  body: string,
  expectedRevision: number
): Promise<number> {
  const { data, error } = await supabase.rpc('postshow_update_inbox_draft', {
    p_item: itemId,
    p_title: title,
    p_body: body,
    p_action_type: null,
    p_action_config: null,
    p_account: null,
    p_expected_revision: expectedRevision,
  });
  if (error) throw new Error(error.message);
  if (!Number.isSafeInteger(data) || (data as number) <= expectedRevision) {
    throw new Error('Draft update returned an invalid revision.');
  }
  return data as number;
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

export async function fetchIncidents(workspaceId: string): Promise<CustomerIncident[]> {
  const { data, error } = await supabase
    .from('postshow_customer_incidents')
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('lifecycle_state', 'closed')
    .order('last_seen_at', { ascending: false })
    .limit(200);
  return throwing(data, error).map(customerIncident);
}

export async function fetchAccountIncidentLinks(
  workspaceId: string
): Promise<AccountIncidentLink[]> {
  const [{ data: links, error: linksError }, { data: incidents, error: incidentsError }] =
    await Promise.all([
      supabase
        .from('postshow_incident_accounts')
        .select('account_id, incident_id')
        .eq('workspace_id', workspaceId),
      supabase
        .from('postshow_customer_incidents')
        .select('id, title, lifecycle_state, severity, evidence_refs')
        .eq('workspace_id', workspaceId)
        .neq('lifecycle_state', 'closed'),
    ]);
  if (linksError) throw new Error(linksError.message);
  if (incidentsError) throw new Error(incidentsError.message);
  const byId = new Map(
    (incidents ?? []).map((incident) => [
      incident.id,
      incident as Omit<CustomerIncident, 'workspace_id'>,
    ])
  );
  return (links ?? []).flatMap((link) => {
    const incident = byId.get(link.incident_id);
    return incident
      ? [
          {
            account_id: link.account_id,
            incident_id: link.incident_id,
            title: incident.title,
            lifecycle_state: incident.lifecycle_state,
            severity: incident.severity,
            session_ids: incident.evidence_refs?.session_ids ?? [],
          },
        ]
      : [];
  });
}

export async function fetchIncidentDossier(
  workspaceId: string,
  incidentId: string
): Promise<IncidentDossier> {
  const [{ data: incident, error: incidentError }, linksResult, notesResult, inboxResult] =
    await Promise.all([
      supabase
        .from('postshow_customer_incidents')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', incidentId)
        .maybeSingle(),
      supabase
        .from('postshow_incident_accounts')
        .select('workspace_id, incident_id, account_id, confidence, evidence')
        .eq('workspace_id', workspaceId)
        .eq('incident_id', incidentId),
      supabase
        .from('postshow_field_notes')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('incident_id', incidentId)
        .order('created_at', { ascending: false }),
      supabase
        .from('postshow_inbox_items')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('incident_id', incidentId)
        .order('created_at', { ascending: false }),
    ]);
  if (incidentError) throw new Error(incidentError.message);
  if (!incident) throw new Error('Incident not found.');
  if (linksResult.error) throw new Error(linksResult.error.message);
  if (notesResult.error) throw new Error(notesResult.error.message);
  if (inboxResult.error) throw new Error(inboxResult.error.message);

  const rawLinks = (linksResult.data ?? []) as Omit<IncidentAccount, 'account'>[];
  const accountIds = rawLinks.map((link) => link.account_id);
  let accounts: Account[] = [];
  if (accountIds.length > 0) {
    const { data, error } = await supabase
      .from('postshow_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('id', accountIds);
    if (error) throw new Error(error.message);
    accounts = (data ?? []) as Account[];
  }
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  return {
    incident: customerIncident(incident),
    accounts: rawLinks.flatMap((link) => {
      const account = accountById.get(link.account_id);
      return account ? [{ ...link, account }] : [];
    }),
    fieldNotes: (notesResult.data ?? []) as FieldNote[],
    inboxItems: (inboxResult.data ?? []) as InboxItem[],
  };
}

export async function fetchPosthogReplayConfig(
  workspaceId: string
): Promise<PosthogReplayConfig | null> {
  const { data, error } = await supabase
    .from('postshow_connections')
    .select('meta, status')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'posthog')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== 'connected') return null;
  const meta =
    data.meta && typeof data.meta === 'object' ? (data.meta as Record<string, unknown>) : {};
  return posthogReplayConfig(meta);
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INVITATION_TOKEN_RE = /^psi_[0-9a-f]{64}$/;
const INVITATION_ROLES = new Set<InvitationRole>(['admin', 'member', 'viewer']);
const INVITATION_STATES = new Set(['active', 'accepted', 'revoked', 'expired']);

function invitationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invitation service returned an invalid response.');
  }
  return value as Record<string, unknown>;
}

function invitationString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invitation service returned an invalid response.');
  }
  return value;
}

function invitationTimestamp(value: unknown): string {
  const timestamp = invitationString(value);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error('Invitation service returned an invalid response.');
  }
  return timestamp;
}

function invitationLink(value: unknown): string {
  const link = invitationString(value);
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error('Invitation service returned an invalid response.');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get('token');
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  const productionOrigin = url.origin === 'https://postshow.io';
  if (
    (!productionOrigin && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== '/invite' ||
    url.search ||
    fragment.size !== 1 ||
    !token ||
    !INVITATION_TOKEN_RE.test(token)
  ) {
    throw new Error('Invitation service returned an invalid response.');
  }
  return link;
}

function parseWorkspaceInvitation(value: unknown): WorkspaceInvitation {
  const row = invitationRecord(value);
  const role = invitationString(row.role);
  if (
    !UUID_RE.test(invitationString(row.id)) ||
    !UUID_RE.test(invitationString(row.workspace_id))
  ) {
    throw new Error('Invitation service returned an invalid response.');
  }
  if (!INVITATION_ROLES.has(role as InvitationRole)) {
    throw new Error('Invitation service returned an invalid response.');
  }
  if (
    (row.accepted_at !== null && typeof row.accepted_at !== 'string') ||
    (row.revoked_at !== null && typeof row.revoked_at !== 'string')
  ) {
    throw new Error('Invitation service returned an invalid response.');
  }
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    email: invitationString(row.email),
    role: role as InvitationRole,
    created_at: invitationTimestamp(row.created_at),
    expires_at: invitationTimestamp(row.expires_at),
    accepted_at: row.accepted_at === null ? null : invitationTimestamp(row.accepted_at),
    revoked_at: row.revoked_at === null ? null : invitationTimestamp(row.revoked_at),
  };
}

export async function fetchInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
  const { data, error } = await supabase
    .from('postshow_workspace_invitations')
    .select('id, workspace_id, email, role, created_at, expires_at, accepted_at, revoked_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Invitation service returned an invalid response.');
  return data.map(parseWorkspaceInvitation);
}

export async function createInvitation(input: {
  requestId: string;
  workspaceId: string;
  email: string;
  role: InvitationRole;
  expiresAt: string;
}): Promise<InvitationDeliveryResult> {
  const result = invitationRecord(
    await invokePostshowFunction('postshow-invitation', {
      request_id: input.requestId,
      workspace_id: input.workspaceId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      expires_at: input.expiresAt,
    })
  );
  if (result.ok !== true) throw new Error('Invitation service returned an invalid response.');
  const invitation = invitationRecord(result.invitation);
  const id = invitationString(invitation.id);
  const state = invitationString(invitation.state);
  const deliveryState = invitationString(invitation.delivery_state);
  if (
    !UUID_RE.test(id) ||
    !INVITATION_STATES.has(state) ||
    (deliveryState !== 'delivered' && deliveryState !== 'failed')
  ) {
    throw new Error('Invitation service returned an invalid response.');
  }
  return {
    id,
    workspace_name: invitationString(invitation.workspace_name),
    state: state as InvitationDeliveryResult['state'],
    expires_at: invitationTimestamp(invitation.expires_at),
    link: invitationLink(invitation.link),
    delivery_state: deliveryState,
  };
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_revoke_invitation', {
    p_invitation: invitationId,
  });
  if (error) throw new Error(error.message);
}

export async function acceptInvitationToken(token: string): Promise<string> {
  if (!INVITATION_TOKEN_RE.test(token)) throw new Error('This invitation link is invalid.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const { data, error } = await supabase.rpc('postshow_accept_invitation', {
    p_token_hash: tokenHash,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || !data) throw new Error('Invitation returned no workspace.');
  return data;
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('postshow_remove_member', {
    p_workspace: workspaceId,
    p_user: userId,
  });
  if (error) throw new Error(error.message);
}

export async function setMemberRole(
  workspaceId: string,
  userId: string,
  role: 'admin' | 'member' | 'viewer'
): Promise<void> {
  const { error } = await supabase.rpc('postshow_set_member_role', {
    p_workspace: workspaceId,
    p_user: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function transferWorkspaceOwnership(
  workspaceId: string,
  newOwnerId: string
): Promise<void> {
  const { error } = await supabase.rpc('postshow_transfer_ownership', {
    p_workspace: workspaceId,
    p_new_owner: newOwnerId,
  });
  if (error) throw new Error(error.message);
}

const API_TOKEN_SCOPES = new Set([
  'workspace:read',
  'connections:read',
  'connections:write',
  'engine:read',
  'engine:write',
  'inbox:read',
  'inbox:skip',
  'accounts:read',
  'notes:read',
  'jobs:read',
  'jobs:run',
  'runs:submit',
  'scratchpad:read',
]);

function tokenRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Access tokens returned an invalid response.');
  }
  return value as Record<string, unknown>;
}

function tokenString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`Access tokens returned an invalid ${label}.`);
  }
  return value;
}

function tokenTimestamp(value: unknown, label: string): string {
  const timestamp = tokenString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Access tokens returned an invalid ${label}.`);
  }
  return timestamp;
}

function nullableTokenTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : tokenTimestamp(value, label);
}

function tokenScopes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 16 ||
    value.some((scope) => typeof scope !== 'string' || !API_TOKEN_SCOPES.has(scope)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('Access tokens returned invalid scopes.');
  }
  return [...value] as string[];
}

function parseApiToken(value: unknown): ApiToken {
  const row = tokenRecord(value);
  const prefix = tokenString(row.token_prefix, 'token prefix');
  if (!/^psh_[0-9a-f]{12}$/.test(prefix)) {
    throw new Error('Access tokens returned an invalid token prefix.');
  }
  return {
    id: tokenString(row.id, 'token id'),
    workspace_id: tokenString(row.workspace_id, 'workspace id'),
    name: tokenString(row.name, 'name', true),
    token_prefix: prefix,
    scopes: tokenScopes(row.scopes),
    expires_at: tokenTimestamp(row.expires_at, 'expiration'),
    created_at: tokenTimestamp(row.created_at, 'creation time'),
    last_used_at: nullableTokenTimestamp(row.last_used_at, 'last-used time'),
    revoked_at: nullableTokenTimestamp(row.revoked_at, 'revocation time'),
  };
}

export async function fetchApiTokens(workspaceId: string): Promise<ApiToken[]> {
  const { data, error } = await supabase
    .from('postshow_api_tokens')
    .select(
      'id, workspace_id, name, token_prefix, scopes, expires_at, created_at, last_used_at, revoked_at'
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  const rows = throwing(data, error);
  if (!Array.isArray(rows)) throw new Error('Access tokens returned an invalid response.');
  return rows.map(parseApiToken);
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
  runtime: 'cloud' | 'local';
}): Promise<void> {
  const { error } = await supabase.rpc('postshow_create_job', {
    p_workspace: input.workspaceId,
    p_label: input.label,
    p_question: input.question ?? '',
    p_interval_minutes: input.intervalMinutes ?? 1440,
    p_runtime: input.runtime,
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

export interface ActionPreviewSnapshot {
  workspace_id: string;
  item_id: string;
  revision: number;
  action_type: ActionType;
  title: string;
  body: string;
  evidence: string;
  action_config: Record<string, unknown>;
  destination: string;
  sender: string;
}

export interface ActionPreview {
  confirmation_id: string;
  confirmation_token: string;
  expires_at: string;
  preview: ActionPreviewSnapshot;
}

function actionRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Action service returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function actionString(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`Action service returned an invalid ${label}.`);
  }
  return value;
}

const ACTION_TYPES = new Set<ActionType>([
  'email',
  'github_issue',
  'linear_issue',
  'adopt_rule',
  'adopt_memory',
  'none',
]);

function actionConfig(value: unknown, actionType: ActionType): Record<string, unknown> {
  const config = actionRecord(value, 'action configuration');
  let serialized = '';
  try {
    serialized = JSON.stringify(config);
  } catch {
    throw new Error('Action service returned an invalid action configuration.');
  }
  if (serialized.length > 4096) {
    throw new Error('Action service returned an invalid action configuration.');
  }
  if (actionType === 'email') {
    if (exactKeys(config, [])) return {};
    if (
      exactKeys(config, ['subject']) &&
      typeof config.subject === 'string' &&
      config.subject.length >= 1 &&
      config.subject.length <= 200
    ) {
      return { subject: config.subject };
    }
  } else if (actionType === 'adopt_rule') {
    if (
      exactKeys(config, ['rule']) &&
      typeof config.rule === 'string' &&
      config.rule.length >= 1 &&
      config.rule.length <= 300
    ) {
      return { rule: config.rule };
    }
  } else if (actionType === 'adopt_memory') {
    if (
      exactKeys(config, ['content', 'key']) &&
      typeof config.key === 'string' &&
      config.key.length >= 1 &&
      config.key.length <= 100 &&
      typeof config.content === 'string' &&
      config.content.length >= 1 &&
      config.content.length <= 600
    ) {
      return { key: config.key, content: config.content };
    }
  } else if (exactKeys(config, [])) {
    return {};
  }
  throw new Error('Action service returned an invalid action configuration.');
}

function parseActionPreview(
  raw: Record<string, unknown>,
  itemId: string,
  expectedRevision: number
): ActionPreview {
  if (
    raw.ok !== true ||
    !exactKeys(raw, ['ok', 'confirmation_id', 'confirmation_token', 'expires_at', 'preview'])
  ) {
    throw new Error('Action service returned an invalid preview.');
  }
  const confirmationId = actionString(raw.confirmation_id, 'confirmation id', 36);
  const confirmationToken = actionString(raw.confirmation_token, 'confirmation token', 68);
  const expiresAt = actionString(raw.expires_at, 'expiration', 64);
  const expiresMs = Date.parse(expiresAt);
  if (
    !UUID_RE.test(confirmationId) ||
    !/^pca_[0-9a-f]{64}$/.test(confirmationToken) ||
    !Number.isFinite(expiresMs) ||
    expiresMs <= Date.now() ||
    expiresMs > Date.now() + 10 * 60_000
  ) {
    throw new Error('Action service returned an invalid preview authorization.');
  }

  const preview = actionRecord(raw.preview, 'preview snapshot');
  if (
    !exactKeys(preview, [
      'workspace_id',
      'item_id',
      'revision',
      'action_type',
      'title',
      'body',
      'evidence',
      'action_config',
      'destination',
      'sender',
    ]) ||
    !Number.isSafeInteger(preview.revision) ||
    (preview.revision as number) < 1 ||
    (preview.revision as number) > 1_000_000
  ) {
    throw new Error('Action service returned an invalid preview snapshot.');
  }
  const workspaceId = actionString(preview.workspace_id, 'workspace id', 36);
  const responseItemId = actionString(preview.item_id, 'item id', 36);
  const actionTypeValue = actionString(preview.action_type, 'action type', 32);
  if (
    !UUID_RE.test(workspaceId) ||
    !UUID_RE.test(responseItemId) ||
    responseItemId !== itemId ||
    preview.revision !== expectedRevision ||
    !ACTION_TYPES.has(actionTypeValue as ActionType)
  ) {
    throw new Error('Action service returned an invalid preview snapshot.');
  }
  const actionType = actionTypeValue as ActionType;
  return {
    confirmation_id: confirmationId,
    confirmation_token: confirmationToken,
    expires_at: expiresAt,
    preview: {
      workspace_id: workspaceId,
      item_id: responseItemId,
      revision: preview.revision as number,
      action_type: actionType,
      title: actionString(preview.title, 'title', 300),
      body: actionString(preview.body, 'body', 10_000, true),
      evidence: actionString(preview.evidence, 'evidence', 500, true),
      action_config: actionConfig(preview.action_config, actionType),
      destination: actionString(preview.destination, 'destination', 500, true),
      sender: actionString(preview.sender, 'sender', 320, true),
    },
  };
}

export async function previewInboxAction(
  itemId: string,
  expectedRevision: number,
  destination?: string
): Promise<ActionPreview> {
  const raw = actionRecord(
    await invokePostshowFunction('postshow-action', {
      op: 'preview',
      item_id: itemId,
      expected_revision: expectedRevision,
      ...(destination ? { destination } : {}),
    }),
    'preview'
  );
  return parseActionPreview(raw, itemId, expectedRevision);
}

export async function executeInboxAction(
  confirmationToken: string
): Promise<{ ok: boolean; detail: string; receipt_id: string }> {
  const raw = actionRecord(
    await invokePostshowFunction('postshow-action', {
      op: 'execute',
      confirmation_token: confirmationToken,
    }),
    'execution result'
  );
  if (raw.ok !== true || !exactKeys(raw, ['ok', 'detail', 'receipt_id'])) {
    throw new Error('The action was not completed.');
  }
  const receiptId = actionString(raw.receipt_id, 'receipt id', 36);
  if (!UUID_RE.test(receiptId)) throw new Error('Action service returned an invalid receipt id.');
  return {
    ok: true,
    detail: actionString(raw.detail, 'result detail', 1000),
    receipt_id: receiptId,
  };
}

export async function testConnection(
  connectionId: string,
  sendTestMessage = false
): Promise<{ ok: boolean; detail: string }> {
  const raw = await invokeFunction<unknown>('postshow-connection-test', {
    connection_id: connectionId,
    ...(sendTestMessage ? { send_test_message: true } : {}),
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Connection test returned an invalid response.');
  }
  const result = raw as Record<string, unknown>;
  if (
    !exactKeys(result, ['ok', 'detail']) ||
    typeof result.ok !== 'boolean' ||
    typeof result.detail !== 'string' ||
    result.detail.length < 1 ||
    result.detail.length > 1000
  ) {
    throw new Error('Connection test returned an invalid response.');
  }
  return { ok: result.ok, detail: result.detail };
}

export type ManualRunResult =
  | { ok: true; run_id: string; status: 'running' }
  | { ok: true; run_id: string; stats: Record<string, unknown> };

function parseManualRunResult(value: unknown): ManualRunResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Run service returned an invalid response.');
  }
  const row = value as Record<string, unknown>;
  if (row.ok !== true || typeof row.run_id !== 'string' || !UUID_RE.test(row.run_id)) {
    throw new Error('Run service returned an invalid response.');
  }
  const keys = Object.keys(row).sort();
  if (
    keys.length === 3 &&
    keys[0] === 'ok' &&
    keys[1] === 'run_id' &&
    keys[2] === 'status' &&
    row.status === 'running'
  ) {
    return { ok: true, run_id: row.run_id, status: 'running' };
  }
  if (
    keys.length === 3 &&
    keys[0] === 'ok' &&
    keys[1] === 'run_id' &&
    keys[2] === 'stats' &&
    row.stats !== null &&
    typeof row.stats === 'object' &&
    !Array.isArray(row.stats)
  ) {
    return { ok: true, run_id: row.run_id, stats: row.stats as Record<string, unknown> };
  }
  throw new Error('Run service returned an invalid response.');
}

export async function runJobNow(jobId: string, requestId: string): Promise<ManualRunResult> {
  if (!UUID_RE.test(jobId) || !UUID_RE.test(requestId)) {
    throw new Error('Run request identifiers are invalid.');
  }
  return parseManualRunResult(
    await invokePostshowFunction('postshow-run', {
      job_id: jobId,
      request_id: requestId,
    })
  );
}

export async function createApiToken(
  workspaceId: string,
  name: string
): Promise<ApiTokenCreationResult> {
  const raw = tokenRecord(
    await invokeFunction<unknown>('postshow-token', { workspace_id: workspaceId, name })
  );
  if (raw.ok !== true) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'Could not create token.');
  }
  const token = tokenString(raw.token, 'token');
  const tokenPrefix = tokenString(raw.token_prefix, 'token prefix');
  if (!/^psh_[0-9a-f]{64}$/.test(token) || tokenPrefix !== token.slice(0, 16)) {
    throw new Error('Token service returned an invalid credential.');
  }
  return {
    ok: true,
    token,
    token_prefix: tokenPrefix,
    scopes: tokenScopes(raw.scopes),
    expires_at: tokenTimestamp(raw.expires_at, 'expiration'),
  };
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
