import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '@/state/WorkspaceContext';
import {
  fetchInbox,
  skipInboxItem,
  previewInboxAction,
  executeInboxAction,
  updateInboxDraft,
  fetchWorkspacePermissions,
  fetchPosthogReplayConfig,
  type ActionPreview,
} from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { PageHeader, EmptyState, LoadingRow, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import type { InboxItem } from '@/lib/types';
import type { PosthogReplayConfig } from '@/lib/types';
import { ReplayLinks } from '@/components/ReplayLinks';

function ItemRow({
  item,
  canOperate,
  canApprove,
  replay,
  focused,
  onChanged,
}: {
  item: InboxItem;
  canOperate: boolean;
  canApprove: boolean;
  replay: PosthogReplayConfig | null;
  focused: boolean;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(focused);
  const rowRef = useRef<HTMLLIElement>(null);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState<'approve' | 'skip' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState<ActionPreview | null>(null);

  // The CLI and MCP surfaces hand a person a link to one exact item. Landing on
  // a list that does not say which one was meant is how the wrong action gets
  // reviewed.
  useEffect(() => {
    if (!focused) return;
    rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  useEffect(() => {
    if (!canOperate) {
      setEditing(false);
      setBody(item.body);
    }
    if (!canApprove) setApproval(null);
  }, [canApprove, canOperate, item.body]);

  async function act(kind: 'approve' | 'skip') {
    if (busy || (kind === 'approve' ? !canApprove : !canOperate)) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'approve') {
        const result = await previewInboxAction(item.id, item.action_revision);
        if (
          result.preview.item_id !== item.id ||
          result.preview.revision !== item.action_revision
        ) {
          throw new Error(
            'The draft changed while preparing approval. Reload and review it again.'
          );
        }
        setApproval(result);
        setExpanded(true);
        setBusy(null);
        return;
      } else {
        await skipInboxItem(item.id, item.action_revision);
      }
      track('inbox_item_skipped', { kind: item.kind });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(null);
    }
  }

  async function confirmApproval() {
    if (!canApprove || !approval || busy) return;
    setBusy('approve');
    setError('');
    try {
      await executeInboxAction(approval.confirmation_token);
      track('inbox_item_approved', { kind: item.kind });
      setApproval(null);
      onChanged();
    } catch (e) {
      setApproval(null);
      setError(
        `${e instanceof Error ? e.message : 'The action could not be completed.'} Review the current draft and try again.`
      );
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!canOperate || busy) return;
    setBusy('save');
    setError('');
    try {
      await updateInboxDraft(item.id, item.title, body, item.action_revision);
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
    <li
      ref={rowRef}
      className={`ps-card flex flex-col gap-3 p-5${focused ? ' border-signal' : ''}`}
    >
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ReplayLinks sessionIds={item.session_ids ?? []} config={replay} />
            {item.incident_id ? (
              <Link
                to={`/incidents/${item.incident_id}`}
                className="font-public-mono text-[10px] uppercase tracking-[0.1em] text-signal hover:text-night-fg"
              >
                review incident →
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canApprove ? (
            <button
              type="button"
              onClick={() => void act('approve')}
              disabled={busy !== null}
              className="ps-btn-primary"
            >
              {busy === 'approve'
                ? 'Preparing…'
                : `Review ${actionable ? item.action_label.toLowerCase() : 'mark done'}`}
            </button>
          ) : null}
          {canOperate ? (
            <button
              type="button"
              onClick={() => void act('skip')}
              disabled={busy !== null}
              className="ps-btn-ghost"
            >
              Skip
            </button>
          ) : (
            <span className="font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
              read-only
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-dashed border-night-3 pt-3">
          {editing && canOperate ? (
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
              {canOperate ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="ps-btn-ghost w-fit"
                >
                  Edit draft
                </button>
              ) : null}
            </>
          )}
        </div>
      )}

      {approval && canApprove && (
        <section
          className="flex flex-col gap-3 rounded-md border border-signal/40 bg-night-2 p-4"
          aria-labelledby={`approval-title-${item.id}`}
        >
          <div>
            <p className="m-0 font-public-mono text-[10px] font-medium uppercase tracking-[0.14em] text-signal">
              Final approval
            </p>
            <h4
              id={`approval-title-${item.id}`}
              className="m-0 mt-1 font-public-sans text-[15px] font-semibold text-night-fg"
            >
              Review the exact action
            </h4>
          </div>
          {approval.preview.destination && (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="font-public-mono uppercase tracking-[0.08em] text-night-fg-3">
                Destination
              </dt>
              <dd className="m-0 break-all font-public-sans text-night-fg">
                {approval.preview.destination}
              </dd>
              {approval.preview.sender && (
                <>
                  <dt className="font-public-mono uppercase tracking-[0.08em] text-night-fg-3">
                    Sender
                  </dt>
                  <dd className="m-0 break-all font-public-sans text-night-fg">
                    {approval.preview.sender}
                  </dd>
                </>
              )}
            </dl>
          )}
          <div className="rounded-sm border border-night-4 bg-night-1 p-3">
            <p className="m-0 font-public-sans text-[13px] font-semibold text-night-fg">
              {approval.preview.title}
            </p>
            <pre className="m-0 mt-2 whitespace-pre-wrap font-public-sans text-[13px] leading-[1.6] text-night-fg-2">
              {approval.preview.body || 'No body.'}
            </pre>
          </div>
          <p className="m-0 font-public-sans text-[11px] leading-[1.5] text-night-fg-3">
            Nothing has been sent. This one-time approval expires at{' '}
            {new Date(approval.expires_at).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void confirmApproval()}
              disabled={busy !== null}
              className="ps-btn-primary"
            >
              {busy === 'approve'
                ? 'Executing…'
                : approval.preview.action_type === 'email'
                  ? 'Confirm and send'
                  : approval.preview.action_type === 'github_issue' ||
                      approval.preview.action_type === 'linear_issue'
                    ? 'Confirm and file issue'
                    : 'Confirm action'}
            </button>
            <button
              type="button"
              onClick={() => setApproval(null)}
              disabled={busy !== null}
              className="ps-btn-ghost"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {error && <ErrorRow message={error} />}
    </li>
  );
}

export function InboxPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const [searchParams] = useSearchParams();
  const focusedItemId = searchParams.get('item') ?? '';
  const fetcher = useCallback(() => fetchInbox(workspaceId), [workspaceId]);
  const { data, loading, error, reload } = usePageData(fetcher);
  const replayFetcher = useCallback(() => fetchPosthogReplayConfig(workspaceId), [workspaceId]);
  const { data: replay } = usePageData(replayFetcher);
  const permissionsFetcher = useCallback(
    () => fetchWorkspacePermissions(workspaceId),
    [workspaceId]
  );
  const {
    data: permissions,
    loading: permissionsLoading,
    error: permissionsError,
    reload: reloadPermissions,
  } = usePageData(permissionsFetcher);
  const permissionsReady =
    !permissionsLoading && !permissionsError && permissions?.workspace_id === workspaceId;
  const canOperate = permissionsReady && permissions.operate;
  const canApprove = canOperate && permissions.approve_actions;

  const currentItems = (data ?? []).filter((item) => item.workspace_id === workspaceId);
  const pending = currentItems.filter((i) => i.state === 'pending');
  const resolved = currentItems.filter((i) => i.state !== 'pending').slice(0, 20);

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
      {permissionsLoading ? (
        <p className="mb-4 font-public-sans text-[12px] text-night-fg-3" role="status">
          Checking inbox permissions… Draft controls remain locked.
        </p>
      ) : permissionsError ? (
        <div className="mb-4 flex flex-wrap items-center gap-3" role="alert">
          <span className="font-public-sans text-[12px] text-bad">
            Inbox permissions could not be verified. Draft controls remain locked.
          </span>
          <button type="button" onClick={reloadPermissions} className="ps-btn-ghost">
            Retry permission check
          </button>
        </div>
      ) : permissionsReady && !canOperate ? (
        <p className="mb-4 font-public-sans text-[12px] text-night-fg-2">
          Inbox drafts are read-only for your workspace role.
        </p>
      ) : permissionsReady && !canApprove ? (
        <p className="mb-4 font-public-sans text-[12px] text-night-fg-2">
          You can edit or skip drafts. An owner or admin must approve irreversible actions.
        </p>
      ) : null}
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
            <ItemRow
              key={`${workspaceId}:${item.id}`}
              item={item}
              canOperate={canOperate}
              canApprove={canApprove}
              replay={replay}
              focused={item.id === focusedItemId}
              onChanged={reload}
            />
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
