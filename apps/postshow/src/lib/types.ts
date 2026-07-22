export interface Workspace {
  id: string;
  name: string;
  plan: 'free' | 'solo' | 'team' | 'enterprise';
  agent_rules: string[];
  created_at: string;
}

export type Provider =
  | 'posthog'
  | 'stripe'
  | 'postgres'
  | 'github'
  | 'linear'
  | 'resend'
  | 'slack'
  | 'mixpanel'
  | 'amplitude'
  | 'ga4'
  | 'intercom'
  | 'sentry'
  | 'hubspot'
  | 'openreplay';

export interface Connection {
  id: string;
  workspace_id: string;
  provider: Provider;
  label: string;
  status: 'unverified' | 'connected' | 'error';
  local_only: boolean;
  meta: Record<string, unknown>;
  last_checked_at: string | null;
  created_at: string;
}

export type EngineProvider =
  | 'anthropic'
  | 'openai'
  | 'moonshot'
  | 'zhipu'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'compatible'
  | 'ollama';

export type EngineTaskClass = 'narration' | 'investigation' | 'deep_dive' | 'drafting';

export type EngineEffort = 'minimal' | 'low' | 'medium' | 'high' | 'max';

export interface EngineTaskPref {
  mode?: 'hosted' | 'byok' | 'local';
  provider?: EngineProvider;
  model?: string;
  effort?: EngineEffort;
}

export interface EngineSettings {
  workspace_id: string;
  mode: 'byok' | 'hosted' | 'local';
  provider: EngineProvider;
  model: string;
  base_url: string;
  task_prefs: Partial<Record<EngineTaskClass, EngineTaskPref>>;
}

export interface UsageSummaryRow {
  task_class: EngineTaskClass;
  runs: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_micros: number;
  units: number;
}

export interface WorkspaceMember {
  user_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  created_at: string;
}

export interface WorkspacePermissions {
  workspace_id: string;
  operate: boolean;
  approve_actions: boolean;
  manage_settings: boolean;
  manage_members: boolean;
  manage_billing: boolean;
  delete_workspace: boolean;
}

export type InvitationRole = 'admin' | 'member' | 'viewer';
export type InvitationState = 'active' | 'accepted' | 'revoked' | 'expired';
export type InvitationDeliveryState = 'delivered' | 'failed';

export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  email: string;
  role: InvitationRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface InvitationDeliveryResult {
  id: string;
  workspace_name: string;
  state: InvitationState;
  expires_at: string;
  link: string;
  delivery_state: InvitationDeliveryState;
}

export interface Entitlements {
  workspace_id: string;
  sessions_watched: number | null;
  deep_dives: number | null;
  investigations: number | null;
  seats: number | null;
  metered: boolean;
}

export interface ApiToken {
  id: string;
  workspace_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface ApiTokenCreationResult {
  ok: true;
  token: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string;
}

export type InboxKind = 'outreach' | 'ticket' | 'save_play' | 'expansion' | 'activation' | 'other';
export type InboxState = 'pending' | 'approved' | 'skipped' | 'failed' | 'needs_review';
export type ActionType =
  | 'email'
  | 'github_issue'
  | 'linear_issue'
  | 'adopt_rule'
  | 'adopt_memory'
  | 'none';

export interface InboxItem {
  id: string;
  workspace_id: string;
  account_id: string | null;
  kind: InboxKind;
  meta: string;
  title: string;
  body: string;
  evidence: string;
  action_label: string;
  action_type: ActionType;
  action_config: Record<string, unknown>;
  action_revision: number;
  state: InboxState;
  resolution: Record<string, unknown>;
  resolved_at: string | null;
  session_ids: string[];
  account_identity_keys: string[];
  incident_id: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  status_tone: 'good' | 'warn' | 'bad';
  mrr_cents: number | null;
  seats: number | null;
  facts: string[];
  next_move: string;
  health_score: number | null;
  last_activity_at: string | null;
  updated_at: string;
}

export interface FieldNote {
  id: string;
  workspace_id: string;
  title: string;
  detail: string;
  sessions: number;
  severity: 'high' | 'medium' | 'low';
  source: string;
  state: 'open' | 'drafted' | 'dismissed';
  session_ids: string[];
  account_identity_keys: string[];
  root_cause_hypothesis: string;
  incident_id: string | null;
  run_id: string | null;
  created_at: string;
}

export type IncidentLifecycle =
  | 'investigating'
  | 'intervention_pending'
  | 'monitoring'
  | 'resolved'
  | 'inconclusive'
  | 'closed';

export type IncidentEvidenceDecision = 'act' | 'gather_more' | 'abstain';
export type IncidentEvidenceStatus = 'supported' | 'partial' | 'not_linked' | 'missing';
export type IncidentEvidenceSourceState =
  | 'complete'
  | 'sampled'
  | 'partial'
  | 'failed'
  | 'not_gathered';

export interface IncidentEvidenceRequirement {
  key: 'behavior' | 'account_identity' | 'technical_failure' | 'code_context' | 'recovery_check';
  status: IncidentEvidenceStatus;
  evidence_count: number;
  sources: string[];
  source_states: Record<string, IncidentEvidenceSourceState>;
}

export interface IncidentEvidenceLedger {
  policy_version: string;
  evaluated_run_id: string | null;
  decision: IncidentEvidenceDecision;
  reason_code: string;
  requirements: IncidentEvidenceRequirement[];
  gaps: string[];
  source_context: {
    version?: number;
    sources?: Record<
      string,
      { state?: IncidentEvidenceSourceState; returned?: number; available?: number | null }
    >;
  };
}

export interface CustomerIncident {
  id: string;
  workspace_id: string;
  fingerprint: string;
  title: string;
  summary: string;
  lifecycle_state: IncidentLifecycle;
  severity: 'high' | 'medium' | 'low';
  revenue_exposure_cents: number | null;
  currency: string;
  evidence_refs: {
    session_ids?: string[];
    account_identity_keys?: string[];
    source_coverage?: {
      complete?: boolean;
      sampled?: boolean;
      matchedSessions?: number;
      unmatchedSessions?: number;
      ambiguousEmails?: number;
      conflictingDistinctIds?: number;
      reasons?: string[];
    };
  };
  root_cause_hypothesis: { status?: 'suspected' | 'unverified'; summary?: string };
  verification_contract: {
    metric?: string;
    baseline?: number;
    direction?: string;
    check_after_days?: number;
    status?: string;
  };
  measured_outcome: { status?: string; [key: string]: unknown };
  evidence_ledger: IncidentEvidenceLedger;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface IncidentAccount {
  workspace_id: string;
  incident_id: string;
  account_id: string;
  confidence: number;
  evidence: Record<string, unknown>;
  account: Account;
}

export interface AccountIncidentLink {
  account_id: string;
  incident_id: string;
  title: string;
  lifecycle_state: IncidentLifecycle;
  severity: 'high' | 'medium' | 'low';
  session_ids: string[];
}

export interface IncidentDossier {
  incident: CustomerIncident;
  accounts: IncidentAccount[];
  fieldNotes: FieldNote[];
  inboxItems: InboxItem[];
}

export interface PosthogReplayConfig {
  origin: string;
  projectId: string;
}

export type JobStatus = 'active' | 'paused' | 'proposed' | 'vetoed' | 'done';

export interface Job {
  id: string;
  workspace_id: string;
  label: string;
  kind: 'session_sweep' | 'deep_dive' | 'investigation' | 'custom';
  schedule_cron: string | null;
  interval_minutes: number | null;
  runtime: 'cloud' | 'local';
  schedule_label: string;
  status: JobStatus;
  proposed_reason: string;
  created_by: 'user' | 'agent';
  last_run_at: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  workspace_id: string;
  job_id: string | null;
  status: 'running' | 'ok' | 'error';
  summary: string;
  stats: Record<string, unknown>;
  error: string;
  started_at: string;
  finished_at: string | null;
}

export interface Subscription {
  workspace_id: string;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
}
