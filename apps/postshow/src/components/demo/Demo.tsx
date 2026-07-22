import { useState } from 'react';
import {
  DEMO_ITEMS,
  DEMO_ACCOUNTS,
  DEMO_NOTES,
  DEMO_JOBS,
  DEMO_NIGHT_LOG,
  DEMO_PROPOSAL,
  DEMO_CONNECTIONS,
  type DemoTab,
  type DemoItem,
  type ItemState,
  type DemoJob,
  type DemoConnection,
  type DemoNote,
} from './data';

const TABS: DemoTab[] = [
  'Inbox',
  'Night log',
  'Accounts',
  'Field notes',
  'Work plan',
  'Connections',
];
const TONE = { good: 'bg-signal', warn: 'bg-warn', bad: 'bg-bad' } as const;
const SEVERITY = { high: 'text-bad', medium: 'text-warn', low: 'text-night-fg-3' } as const;

/** The live demo: a framed window into the product. Every control works;
 * state is plain React, per visitor, gone on refresh. */
export function Demo() {
  const [tab, setTab] = useState<DemoTab>('Inbox');
  const [items, setItems] = useState<DemoItem[]>(DEMO_ITEMS);
  const [openIncident, setOpenIncident] = useState(false);
  const [openAccount, setOpenAccount] = useState<string | null>('lattice');
  const [jobs, setJobs] = useState<DemoJob[]>(DEMO_JOBS);
  const [proposal, setProposal] = useState<'open' | 'approved' | 'vetoed'>('open');
  const [connections, setConnections] = useState<DemoConnection[]>(DEMO_CONNECTIONS);
  const [engine, setEngine] = useState<'local' | 'byok'>('local');

  const pending = items.filter((i) => i.state === 'pending').length;
  const done = items.filter((i) => i.state === 'done').length;
  const skipped = items.filter((i) => i.state === 'skipped').length;
  const draftedNoteIds = items
    .filter((i) => i.id.startsWith('note-'))
    .map((i) => i.id.slice('note-'.length));

  const setItem = (id: string, state: ItemState) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, state } : i)));

  function draftTicket(note: DemoNote) {
    setItems((prev) => [
      ...prev,
      {
        id: `note-${note.id}`,
        meta: `Friction · ${note.title}`,
        title: `Ticket drafted from ${note.sessions} watched sessions.`,
        evidence: `${note.sessions} sessions · severity ${note.severity}`,
        action: 'Open ticket',
        doneLabel: 'Ticket filed',
        state: 'pending',
      },
    ]);
    setTab('Inbox');
  }

  return (
    <div className="overflow-hidden rounded-xl border-[3px] border-signal bg-night-0 text-left shadow-[0_32px_80px_rgba(20,23,15,0.25)]">
      <div className="flex flex-wrap items-center gap-1 border-b border-night-3 bg-night-2 px-3 py-2">
        {TABS.map((label) => {
          const active = tab === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setTab(label)}
              aria-current={active || undefined}
              className={[
                'flex shrink-0 items-center gap-2 rounded-pill px-4 py-[7px] font-public-sans text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal',
                active
                  ? 'bg-signal font-medium text-signal-ink'
                  : 'text-night-fg-2 hover:text-night-fg',
              ].join(' ')}
            >
              {label}
              {label === 'Inbox' && pending > 0 && (
                <span
                  className={[
                    'rounded-pill px-[7px] py-[1px] font-public-mono text-[10px] font-semibold',
                    active ? 'bg-signal-ink text-signal' : 'bg-signal text-signal-ink',
                  ].join(' ')}
                >
                  {pending}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-[340px]">
        {tab === 'Inbox' && (
          <div>
            <p className="m-0 border-b border-night-3 px-5 py-3 font-public-sans text-[13px] font-medium text-night-fg-2">
              {pending > 0
                ? `${pending} draft${pending === 1 ? '' : 's'} from last night`
                : 'All clear.'}
            </p>
            {openIncident ? (
              <div className="px-5 py-5">
                <button
                  type="button"
                  onClick={() => setOpenIncident(false)}
                  className="rounded-sm font-public-mono text-[11px] uppercase tracking-[0.14em] text-signal hover:text-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                >
                  ← Back to inbox
                </button>
                <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
                  <div>
                    <p className="m-0 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em] text-signal">
                      Customer incident · Onboarding
                    </p>
                    <h3 className="m-0 mt-2 max-w-[28ch] font-public-sans text-[21px] font-semibold leading-[1.25] text-night-fg">
                      Seven trials stalled while connecting their first data source.
                    </h3>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-night-3 bg-night-1 p-4">
                        <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.14em] text-night-fg-3">
                          Evidence
                        </p>
                        <p className="m-0 mt-2 font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                          Seven replay sessions repeat the same failed connection step.
                        </p>
                      </div>
                      <div className="rounded-lg border border-night-3 bg-night-1 p-4">
                        <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.14em] text-night-fg-3">
                          Account impact
                        </p>
                        <p className="m-0 mt-2 font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                          Three trial accounts have not completed activation. No revenue impact is
                          claimed yet.
                        </p>
                      </div>
                      <div className="rounded-lg border border-night-3 bg-night-1 p-4">
                        <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.14em] text-night-fg-3">
                          Suspected cause
                        </p>
                        <p className="m-0 mt-2 font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                          The evidence points to the validation path in{' '}
                          <code className="font-public-mono text-[11px] text-night-fg">
                            SourceWizard.tsx
                          </code>
                          . Engineering still needs to confirm it.
                        </p>
                      </div>
                      <div className="rounded-lg border border-night-3 bg-night-1 p-4">
                        <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.14em] text-night-fg-3">
                          Verification plan
                        </p>
                        <p className="m-0 mt-2 font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                          Recheck first-source completion seven days after the change. Outcome is
                          pending.
                        </p>
                      </div>
                    </div>
                  </div>
                  <aside className="rounded-lg border border-night-3 bg-night-1 p-4">
                    <p className="m-0 font-public-mono text-[10px] uppercase tracking-[0.14em] text-signal">
                      Pending human review
                    </p>
                    <div className="mt-4 border-t border-night-3 pt-4">
                      <p className="m-0 font-public-sans text-[13px] font-medium text-night-fg">
                        Product intervention
                      </p>
                      <p className="m-0 mt-1 font-public-sans text-[12px] leading-[1.5] text-night-fg-2">
                        Draft a ticket with the replay evidence and suspected validation path.
                      </p>
                    </div>
                    <div className="mt-4 border-t border-night-3 pt-4">
                      <p className="m-0 font-public-sans text-[13px] font-medium text-night-fg">
                        Account recovery
                      </p>
                      <p className="m-0 mt-1 font-public-sans text-[12px] leading-[1.5] text-night-fg-2">
                        Draft a concise follow-up for the three affected trial owners.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setItem('sourcewizard', 'done');
                        setOpenIncident(false);
                      }}
                      className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-pill bg-signal px-4 font-public-sans text-[12px] font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      Approve both drafts
                    </button>
                  </aside>
                </div>
              </div>
            ) : pending === 0 ? (
              <div className="flex flex-col items-start gap-4 px-5 py-10">
                <p className="m-0 font-public-sans text-[16px] font-medium text-night-fg">
                  Inbox zero. Enjoy the coffee.
                </p>
                <p className="m-0 max-w-[46ch] font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                  That took you eleven seconds. Yours would be drafted from your real sessions,
                  accounts, and code.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  <a
                    href="#waitlist"
                    className="inline-flex h-10 items-center rounded-pill bg-signal px-5 font-public-sans text-[13px] font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    Apply for the closed beta →
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setItems(DEMO_ITEMS);
                      setOpenIncident(false);
                    }}
                    className="rounded-sm font-public-mono text-[12px] uppercase tracking-[0.14em] text-signal hover:text-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    replay last night →
                  </button>
                </div>
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={[
                      'flex flex-col gap-2 border-b border-night-3 px-5 py-4 transition-opacity duration-200 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
                      item.state === 'skipped' ? 'opacity-45' : '',
                      item.state === 'done' ? 'opacity-75' : '',
                    ].join(' ')}
                  >
                    <div className="min-w-0">
                      <p className="m-0 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em] text-signal">
                        {item.meta}
                      </p>
                      <p className="m-0 mt-1 font-public-sans text-[14px] font-medium leading-[1.4] text-night-fg">
                        {item.state === 'done' ? `${item.doneLabel} · 07:12` : item.title}
                      </p>
                      <p className="m-0 mt-1 font-public-mono text-[11px] text-night-fg-3">
                        {item.state === 'skipped'
                          ? 'skipped · noted, it learns from this'
                          : item.evidence}
                      </p>
                    </div>
                    {item.state === 'pending' && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (item.id === 'sourcewizard') {
                              setOpenIncident(true);
                            } else {
                              setItem(item.id, 'done');
                            }
                          }}
                          aria-label={`${item.action}: ${item.meta}`}
                          className="inline-flex h-8 items-center rounded-pill bg-signal px-4 font-public-sans text-[12px] font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                        >
                          {item.action}
                        </button>
                        <button
                          type="button"
                          onClick={() => setItem(item.id, 'skipped')}
                          aria-label={`Skip: ${item.meta}`}
                          className="inline-flex h-8 items-center rounded-pill border border-night-4 px-4 font-public-sans text-[12px] text-night-fg-2 hover:bg-night-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                        >
                          Skip
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'Night log' && (
          <div className="px-5 py-4">
            <p className="m-0 pb-3 font-public-sans text-[13px] font-medium text-night-fg-2">
              The tape from last night. Each task ran on its own model and effort.
            </p>
            <ol className="night-log m-0 flex list-none flex-col gap-0 p-0">
              {DEMO_NIGHT_LOG.map((line, index) => (
                <li
                  key={line.at + line.text}
                  className="night-log-line grid grid-cols-[44px_1fr] gap-3 border-l border-night-3 py-2 pl-4"
                  style={{ animationDelay: `${index * 120}ms` }}
                >
                  <span className="font-public-mono text-[11px] text-night-fg-3">{line.at}</span>
                  <span className="min-w-0">
                    {line.engine && (
                      <span className="mr-2 rounded-pill border border-night-4 px-2 py-[1px] font-public-mono text-[9px] uppercase tracking-[0.1em] text-signal">
                        {line.engine}
                      </span>
                    )}
                    <span
                      className={[
                        'font-public-mono text-[12px] leading-[1.6]',
                        line.tone === 'signal'
                          ? 'text-signal'
                          : line.tone === 'dim'
                            ? 'text-night-fg-3'
                            : 'text-night-fg-2',
                      ].join(' ')}
                    >
                      {line.text}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setTab('Inbox')}
              className="mt-3 rounded-sm font-public-mono text-[11px] uppercase tracking-[0.14em] text-signal hover:text-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              see the 3 drafts →
            </button>
            <p className="m-0 mt-3 max-w-[56ch] font-public-sans text-[12px] leading-[1.5] text-night-fg-3">
              You choose the model and effort per task in Settings: cheap and constant for watching,
              frontier only when a deep dive earns it. Any provider, your keys, or local models.
            </p>
          </div>
        )}

        {tab === 'Accounts' && (
          <ul className="m-0 flex list-none flex-col p-0">
            {DEMO_ACCOUNTS.map((account) => {
              const open = openAccount === account.id;
              return (
                <li key={account.id} className="border-b border-night-3 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenAccount(open ? null : account.id)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left hover:bg-night-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className={`inline-block h-[7px] w-[7px] shrink-0 rounded-pill ${TONE[account.tone]}`}
                        aria-hidden
                      />
                      <span className="truncate font-public-sans text-[14px] font-medium text-night-fg">
                        {account.name}
                      </span>
                    </span>
                    <span className="shrink-0 font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
                      {account.status}
                    </span>
                  </button>
                  {open && (
                    <div className="flex flex-col gap-2 px-5 pb-4 pl-[35px]">
                      <p className="m-0 font-public-mono text-[11px] text-night-fg-3">
                        {account.fact}
                      </p>
                      <p className="m-0 max-w-[52ch] font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                        <span className="font-medium text-night-fg">Next move: </span>
                        {account.nextMove}
                      </p>
                      {account.hasDraft && (
                        <button
                          type="button"
                          onClick={() => setTab('Inbox')}
                          className="w-fit rounded-sm font-public-mono text-[11px] uppercase tracking-[0.14em] text-signal hover:text-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                        >
                          draft waiting in inbox →
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {tab === 'Field notes' && (
          <ul className="m-0 flex list-none flex-col p-0">
            {DEMO_NOTES.map((note) => {
              const drafted = draftedNoteIds.includes(note.id);
              return (
                <li
                  key={note.id}
                  className="flex flex-col gap-2 border-b border-night-3 px-5 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0">
                    <p className="m-0 flex flex-wrap items-baseline gap-x-3 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em]">
                      <span className={SEVERITY[note.severity]}>{note.severity}</span>
                      <span className="text-night-fg-3">{note.sessions} sessions</span>
                    </p>
                    <p className="m-0 mt-1 font-public-sans text-[14px] font-medium leading-[1.4] text-night-fg">
                      {note.title}
                    </p>
                    <p className="m-0 mt-1 max-w-[56ch] font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                      {note.detail}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {drafted ? (
                      <span className="inline-flex items-center gap-2 font-public-mono text-[11px] uppercase tracking-[0.12em] text-signal">
                        <span className="inline-block h-[6px] w-[6px] bg-signal" aria-hidden />
                        ticket in inbox
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => draftTicket(note)}
                        aria-label={`Draft ticket: ${note.title}`}
                        className="inline-flex h-8 items-center rounded-pill border border-night-4 px-4 font-public-sans text-[12px] text-night-fg-2 hover:bg-night-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                      >
                        Draft ticket
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tab === 'Work plan' && (
          <ul className="m-0 flex list-none flex-col p-0">
            {jobs.map((job) => {
              const paused = job.status === 'paused';
              return (
                <li
                  key={job.id}
                  className={`flex items-center justify-between gap-4 border-b border-night-3 px-5 py-4 ${paused ? 'opacity-50' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="m-0 font-public-sans text-[14px] font-medium leading-[1.4] text-night-fg">
                      {job.label}
                    </p>
                    <p className="m-0 mt-1 font-public-mono text-[11px] uppercase tracking-[0.12em] text-night-fg-3">
                      {job.schedule}
                      {paused && ' · paused'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setJobs((prev) =>
                        prev.map((j) =>
                          j.id === job.id
                            ? { ...j, status: j.status === 'active' ? 'paused' : 'active' }
                            : j
                        )
                      )
                    }
                    aria-label={`${paused ? 'Resume' : 'Pause'}: ${job.label}`}
                    className="inline-flex h-8 shrink-0 items-center rounded-pill border border-night-4 px-4 font-public-sans text-[12px] text-night-fg-2 hover:bg-night-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    {paused ? 'Resume' : 'Pause'}
                  </button>
                </li>
              );
            })}
            {proposal === 'open' && (
              <li className="flex flex-col gap-3 border-l-2 border-l-signal px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="m-0 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em] text-signal">
                    proposed by postshow
                  </p>
                  <p className="m-0 mt-1 font-public-sans text-[14px] font-medium leading-[1.4] text-night-fg">
                    {DEMO_PROPOSAL.label}
                  </p>
                  <p className="m-0 mt-1 font-public-mono text-[11px] uppercase tracking-[0.12em] text-night-fg-3">
                    {DEMO_PROPOSAL.schedule}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setProposal('approved');
                      setJobs((prev) => [
                        ...prev,
                        {
                          id: 'signup-watch',
                          label: DEMO_PROPOSAL.label,
                          schedule: 'jul 27 to aug 2 · approved by you',
                          status: 'active',
                        },
                      ]);
                    }}
                    className="inline-flex h-8 items-center rounded-pill bg-signal px-4 font-public-sans text-[12px] font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setProposal('vetoed')}
                    className="inline-flex h-8 items-center rounded-pill border border-night-4 px-4 font-public-sans text-[12px] text-night-fg-2 hover:bg-night-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    Veto
                  </button>
                </div>
              </li>
            )}
            {proposal === 'vetoed' && (
              <li className="px-5 py-4">
                <p className="m-0 font-public-mono text-[11px] uppercase tracking-[0.12em] text-night-fg-3">
                  proposal vetoed · it won&rsquo;t re-propose this one for a month
                </p>
              </li>
            )}
          </ul>
        )}

        {tab === 'Connections' && (
          <ul className="m-0 flex list-none flex-col p-0">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="flex flex-col gap-2 border-b border-night-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0">
                  <p className="m-0 flex items-center gap-3 font-public-sans text-[14px] font-medium text-night-fg">
                    <span
                      className={`inline-block h-[7px] w-[7px] rounded-pill ${connection.connected ? 'bg-signal' : 'bg-night-4'}`}
                      aria-hidden
                    />
                    {connection.name}
                  </p>
                  <p className="m-0 mt-1 pl-[19px] font-public-mono text-[11px] text-night-fg-3">
                    {connection.detail}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 pl-[19px] sm:pl-0">
                  {connection.connected ? (
                    <span className="inline-flex h-8 items-center font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
                      read-only
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setConnections((prev) =>
                          prev.map((c) => (c.id === connection.id ? { ...c, connected: true } : c))
                        )
                      }
                      aria-label={`Connect ${connection.name}`}
                      className="inline-flex h-8 items-center rounded-pill bg-signal px-4 font-public-sans text-[12px] font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </li>
            ))}
            <li className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div>
                <p className="m-0 font-public-sans text-[14px] font-medium text-night-fg">Engine</p>
                <p className="m-0 mt-1 font-public-mono text-[11px] text-night-fg-3">
                  {engine === 'local'
                    ? 'llama on this machine · nothing leaves the building'
                    : 'your api key · strong models wake for deep dives'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {(['local', 'byok'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setEngine(option)}
                    aria-pressed={engine === option}
                    className={[
                      'inline-flex h-8 items-center rounded-pill border px-4 font-public-sans text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                      engine === option
                        ? 'border-signal text-signal'
                        : 'border-night-4 text-night-fg-2 hover:bg-night-2',
                    ].join(' ')}
                  >
                    {option === 'local' ? 'Local models' : 'Your key'}
                  </button>
                ))}
              </div>
            </li>
          </ul>
        )}
      </div>

      <p className="m-0 flex flex-wrap gap-x-4 border-t border-night-3 bg-night-2 px-5 py-2 font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
        <span>312 sessions triaged · 40 narrated</span>
        <span>1 incident built</span>
        <span>engine · {engine === 'local' ? 'local' : 'your key'}</span>
        {done > 0 && <span className="text-signal">{done} approved</span>}
        {skipped > 0 && <span>{skipped} skipped</span>}
      </p>
    </div>
  );
}
