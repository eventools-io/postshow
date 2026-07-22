export type DemoTab =
  | 'Inbox'
  | 'Night log'
  | 'Accounts'
  | 'Field notes'
  | 'Work plan'
  | 'Connections';

export type ItemState = 'pending' | 'done' | 'skipped';

export interface DemoItem {
  id: string;
  meta: string;
  title: string;
  evidence: string;
  action: string;
  doneLabel: string;
  state: ItemState;
}

export interface DemoAccount {
  id: string;
  name: string;
  status: string;
  tone: 'good' | 'warn' | 'bad';
  fact: string;
  nextMove: string;
  hasDraft: boolean;
}

export interface DemoNote {
  id: string;
  title: string;
  detail: string;
  sessions: number;
  severity: 'high' | 'medium' | 'low';
}

export interface DemoJob {
  id: string;
  label: string;
  schedule: string;
  status: 'active' | 'paused';
}

export interface DemoConnection {
  id: string;
  name: string;
  detail: string;
  connected: boolean;
}

export const DEMO_ITEMS: DemoItem[] = [
  {
    id: 'lattice',
    meta: 'Expansion · Lattice Metrics',
    title: 'They hit the seat limit twice this week. Upgrade email drafted.',
    evidence: '14 sessions · seat modal ×9 · plan page revisited',
    action: 'Approve',
    doneLabel: 'Upgrade email sent',
    state: 'pending',
  },
  {
    id: 'sourcewizard',
    meta: 'Customer incident · Onboarding',
    title: 'Seven trials stalled at the same step. Product ticket and account follow-ups drafted.',
    evidence: '7 replay sessions · 3 affected accounts · SourceWizard.tsx',
    action: 'Review incident',
    doneLabel: 'Interventions approved',
    state: 'pending',
  },
  {
    id: 'deployhub',
    meta: 'Churn risk · DeployHub',
    title: 'Usage cliff after two failed API key rotations. Check-in email drafted.',
    evidence: 'Paying org · 21 quiet days · 401 responses ×34',
    action: 'Approve',
    doneLabel: 'Check-in sent',
    state: 'pending',
  },
];

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: 'lattice',
    name: 'Lattice Metrics',
    status: 'Expansion ready',
    tone: 'good',
    fact: '12 of 12 seats in use · seat limit hit ×2 this week',
    nextMove: 'Send the upgrade email before their quarterly review on Thursday.',
    hasDraft: true,
  },
  {
    id: 'deployhub',
    name: 'DeployHub',
    status: 'At risk',
    tone: 'bad',
    fact: 'Paying org · 21 quiet days · last visit ended on a 401',
    nextMove: 'Personal check-in, and ship the key-rotation fix first.',
    hasDraft: true,
  },
  {
    id: 'brightpath',
    name: 'Brightpath CRM',
    status: 'Steady',
    tone: 'good',
    fact: 'Weekly actives up 3 weeks straight · 6 seats',
    nextMove: 'They export reports by hand every Friday. Show them scheduled digests.',
    hasDraft: false,
  },
  {
    id: 'nimbus',
    name: 'Nimbus Stack',
    status: 'Activation stall',
    tone: 'warn',
    fact: 'Day 6 of trial · connected nothing · invited nobody',
    nextMove: 'Nudge the owner to connect a data source; empty workspaces never convert.',
    hasDraft: false,
  },
];

export const DEMO_NOTES: DemoNote[] = [
  {
    id: 'drag-zone',
    title: 'Dead drag zone in the integrations list',
    detail:
      'People drag connectors onto the sidebar expecting to install them. Nothing happens, they retry slower, some leave.',
    sessions: 47,
    severity: 'high',
  },
  {
    id: 'plan-picker',
    title: 'The plan picker hides monthly pricing',
    detail:
      'Since Thursday, sessions stall on the annual toggle. Nobody scrolls past it; checkout starts are down 22%.',
    sessions: 14,
    severity: 'high',
  },
  {
    id: 'bulk-import',
    title: 'Nobody finds bulk import',
    detail: 'Users add records one at a time for an hour. The importer exists, three menus deep.',
    sessions: 23,
    severity: 'medium',
  },
];

export const DEMO_JOBS: DemoJob[] = [
  {
    id: 'sweep',
    label: 'Session sweep and narration',
    schedule: 'nightly · 02:00',
    status: 'active',
  },
  {
    id: 'deep-dive',
    label: 'Deep dive on the biggest mover',
    schedule: 'fridays · 06:00',
    status: 'active',
  },
  {
    id: 'trial-stalls',
    label: 'Standing investigation: why trials stall before connecting data',
    schedule: 'until resolved',
    status: 'active',
  },
];

export const DEMO_PROPOSAL = {
  label: 'Watch new-signup sessions hourly during launch week',
  schedule: 'proposed · jul 27 to aug 2',
};

export interface DemoLogLine {
  at: string;
  /** Which task class produced this line; blank lines are narration beats. */
  engine?: string;
  text: string;
  tone: 'dim' | 'normal' | 'signal';
}

/** The overnight tape. Each entry names the model tier that did the work,
 * because Postshow resolves an engine per task: fast for watching, standard
 * for recon, frontier only when a deep dive earns it. */
export const DEMO_NIGHT_LOG: DemoLogLine[] = [
  { at: '02:00', text: 'session sweep begins · 312 sessions in the window', tone: 'dim' },
  {
    at: '02:04',
    engine: 'watcher · haiku 4.5 · low',
    text: 'triaged 312 sessions and narrated the 40 highest-signal paths. a dead drag target repeated.',
    tone: 'normal',
  },
  {
    at: '02:11',
    text: 'anomaly: checkout starts down 22% since thursday. flagged for recon.',
    tone: 'signal',
  },
  {
    at: '02:12',
    engine: 'recon · sonnet 5 · medium',
    text: 'traced it to the plan picker: sessions stall on the annual toggle.',
    tone: 'normal',
  },
  {
    at: '02:31',
    engine: 'deep dive · opus 4.8 · high',
    text: 'why: thursday\u2019s redesign hid monthly pricing. affected paths, accounts, and the suspected change are attached.',
    tone: 'normal',
  },
  {
    at: '02:58',
    text: 'lattice metrics hit the seat limit again. expansion play drafted.',
    tone: 'dim',
  },
  {
    at: '03:15',
    text: 'deployhub quiet 21 days after failed key rotations. save play drafted.',
    tone: 'dim',
  },
  {
    at: '07:12',
    text: '3 drafts filed to the inbox. nothing sent without you.',
    tone: 'signal',
  },
];

export const DEMO_CONNECTIONS: DemoConnection[] = [
  { id: 'posthog', name: 'PostHog', detail: 'events + replays', connected: true },
  { id: 'stripe', name: 'Stripe', detail: 'revenue', connected: true },
  { id: 'github', name: 'GitHub', detail: 'code context', connected: true },
  { id: 'sentry', name: 'Sentry', detail: 'errors + traces', connected: false },
];
