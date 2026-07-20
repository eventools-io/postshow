import { useCallback, useState } from 'react';
import { useWorkspace } from '@/state/WorkspaceContext';
import { fetchFieldNotes, draftTicketFromNote } from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { PageHeader, EmptyState, LoadingRow, ErrorRow } from '@/components/page';
import { track } from '@/lib/analytics';
import type { FieldNote } from '@/lib/types';

const SEVERITY_CLASS = { high: 'text-bad', medium: 'text-warn', low: 'text-night-fg-3' } as const;

function NoteRow({ note, onChanged }: { note: FieldNote; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function draft() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await draftTicketFromNote(note.id);
      track('field_note_drafted');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft the ticket.');
      setBusy(false);
    }
  }

  return (
    <li className="ps-card flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em]">
          <span className={SEVERITY_CLASS[note.severity]}>{note.severity}</span>
          <span className="text-night-fg-3">{note.sessions} sessions</span>
        </p>
        <h3 className="m-0 mt-1 font-public-sans text-[15px] font-semibold leading-[1.35] text-night-fg">
          {note.title}
        </h3>
        <p className="m-0 mt-1 max-w-[60ch] font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
          {note.detail}
        </p>
        {error && <ErrorRow message={error} />}
      </div>
      <div className="shrink-0">
        {note.state === 'drafted' ? (
          <span className="inline-flex items-center gap-2 font-public-mono text-[11px] uppercase tracking-[0.12em] text-signal">
            <span className="inline-block h-[6px] w-[6px] bg-signal" aria-hidden />
            ticket in inbox
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void draft()}
            disabled={busy}
            className="ps-btn-ghost"
          >
            {busy ? 'Drafting…' : 'Draft ticket'}
          </button>
        )}
      </div>
    </li>
  );
}

export function FieldNotesPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchFieldNotes(workspaceId), [workspaceId]);
  const { data, loading, error, reload } = usePageData(fetcher);
  const notes = data ?? [];

  return (
    <div>
      <PageHeader
        title="Field notes"
        sub="What the watcher keeps seeing, ranked by how many sessions hit it. Draft a ticket when one is worth fixing."
      />
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && notes.length === 0 && (
        <EmptyState
          title="No field notes yet."
          body="After the session sweep runs, recurring friction shows up here: dead clicks, stalls, confusing flows, with the session counts to back it up."
          cta={{ label: 'Check the work plan', to: '/work-plan' }}
        />
      )}
      {notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}
