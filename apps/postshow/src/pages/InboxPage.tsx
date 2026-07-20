import { useCallback, useState } from 'react';
import { useWorkspace } from '@/state/WorkspaceContext';
import { fetchInbox, skipInboxItem, approveInboxItem, updateInboxDraft } from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { PageHeader, EmptyState, LoadingRow, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import type { InboxItem } from '@/lib/types';

function ItemRow({ item, onChanged }: { item: InboxItem; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState<'approve' | 'skip' | 'save' | null>(null);
  const [error, setError] = useState('');

  async function act(kind: 'approve' | 'skip') {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'approve') {
        const result = await approveInboxItem(item.id);
        if (!result.ok) throw new Error(result.detail || 'The action failed.');
      } else {
        await skipInboxItem(item.id);
      }
      track(`inbox_item_${kind === 'approve' ? 'approved' : 'skipped'}`, { kind: item.kind });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (busy) return;
    setBusy('save');
    setError('');
    try {
      await updateInboxDraft(item.id, body);
      track('inbox_draft_edited', { kind: item.kind });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the draft.');
    } finally {
      setBusy(null);
    }
  }

  const actionable = item.action_type !== 'none';

  return (
    <li className="ps-card flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="m-0 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em] text-signal">
            {item.meta}
          </p>
          <h3 className="m-0 mt-1 font-public-sans text-[15px] font-semibold leading-[1.35] text-night-fg">
            {item.title}
          </h3>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="mt-1 rounded-sm font-public-mono text-[11px] text-night-fg-3 hover:text-night-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {item.evidence || 'no evidence recorded'} {expanded ? '▲' : '▼'}
          </button>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void act('approve')}
            disabled={busy !== null}
            className="ps-btn-primary"
          >
            {busy === 'approve' ? 'Working…' : actionable ? item.action_label : 'Mark done'}
          </button>
          <button
            type="button"
            onClick={() => void act('skip')}
            disabled={busy !== null}
            className="ps-btn-ghost"
          >
            Skip
          </button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-dashed border-night-3 pt-3">
          {editing ? (
            <>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="w-full rounded-sm border border-night-4 bg-night-2 p-3 font-public-sans text-[13px] leading-[1.6] text-night-fg focus:border-signal focus:outline-none"
                aria-label="Draft body"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={busy !== null}
                  className="ps-btn-primary"
                >
                  {busy === 'save' ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setBody(item.body);
                  }}
                  className="ps-btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <pre className="m-0 whitespace-pre-wrap font-public-sans text-[13px] leading-[1.6] text-night-fg-2">
                {item.body || 'No draft body.'}
              </pre>
              <button type="button" onClick={() => setEditing(true)} className="ps-btn-ghost w-fit">
                Edit draft
              </button>
            </>
          )}
        </div>
      )}

      {error && <ErrorRow message={error} />}
    </li>
  );
}

export function InboxPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchInbox(workspaceId), [workspaceId]);
  const { data, loading, error, reload } = usePageData(fetcher);

  const pending = (data ?? []).filter((i) => i.state === 'pending');
  const resolved = (data ?? []).filter((i) => i.state !== 'pending').slice(0, 20);

  return (
    <div>
      <PageHeader
        title="Inbox"
        sub={
          pending.length > 0
            ? `${pending.length} draft${pending.length === 1 ? '' : 's'} waiting. Nothing sends without you.`
            : 'Drafted moves land here after each run. Nothing sends without you.'
        }
      />
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && pending.length === 0 && (
        <EmptyState
          title="No drafts waiting."
          body="When the agent finds something worth doing, the drafted move appears here with its evidence: an outreach email, a friction ticket, a save play. Connect your stack and run a job to get the first ones."
          cta={{ label: 'Go to connections', to: '/connections' }}
        />
      )}
      {pending.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {pending.map((item) => (
            <ItemRow key={item.id} item={item} onChanged={reload} />
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <Section title="Recently handled">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {resolved.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-4 border-b border-night-3 pb-2"
              >
                <span className="min-w-0 truncate font-public-sans text-[13px] text-night-fg-2">
                  {item.title}
                </span>
                <span
                  className={[
                    'shrink-0 font-public-mono text-[10px] uppercase tracking-[0.12em]',
                    item.state === 'approved'
                      ? 'text-signal'
                      : item.state === 'failed'
                        ? 'text-bad'
                        : 'text-night-fg-3',
                  ].join(' ')}
                >
                  {item.state}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
