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
  base_url?: string;
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
  role: 'owner' | 'member';
  created_at: string;
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
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type InboxKind = 'outreach' | 'ticket' | 'save_play' | 'expansion' | 'activation' | 'other';
export type InboxState = 'pending' | 'approved' | 'skipped' | 'failed';
export type ActionType = 'email' | 'github_issue' | 'linear_issue' | 'adopt_rule' | 'none';

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
  state: InboxState;
  resolution: Record<string, unknown>;
  resolved_at: string | null;
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
  created_at: string;
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
