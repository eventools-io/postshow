import { useCallback, useState, type FormEvent } from 'react';
import { useWorkspace } from '@/state/WorkspaceContext';
import { fetchConnections, upsertConnection, deleteConnection, testConnection } from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { CONNECTORS, type ConnectorDef } from '@/lib/connectors';
import { PageHeader, LoadingRow, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import type { Connection } from '@/lib/types';

function ConnectForm({
  def,
  existing,
  workspaceId,
  onDone,
  onCancel,
}: {
  def: ConnectorDef;
  existing: Connection | null;
  workspaceId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of def.metaFields) {
      initial[field.key] = String((existing?.meta as Record<string, unknown>)?.[field.key] ?? '');
    }
    return initial;
  });
  const [localOnly, setLocalOnly] = useState(existing?.local_only ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const secret: Record<string, unknown> = {};
      let hasSecret = false;
      for (const field of def.secretFields) {
        const value = values[field.key]?.trim();
        if (value) {
          secret[field.key] = value;
          hasSecret = true;
        }
      }
      const meta: Record<string, unknown> = {};
      for (const field of def.metaFields) {
        meta[field.key] = values[field.key]?.trim() ?? '';
      }
      await upsertConnection({
        workspaceId,
        provider: def.provider,
        localOnly,
        meta,
        secret: hasSecret ? secret : null,
      });
      track('connection_saved', { provider: def.provider });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the connection.');
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 border-t border-dashed border-night-3 pt-4"
    >
      {[...def.secretFields, ...def.metaFields].map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="ps-label">
            {field.label}
            {def.secretFields.includes(field) && existing && ' (leave blank to keep current)'}
          </span>
          <input
            type={field.kind === 'secret' ? 'password' : 'text'}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            placeholder={field.placeholder}
            className="ps-input"
            autoComplete="off"
            required={
              field.kind === 'secret'
                ? !existing
                : field.kind === 'text' && def.provider === 'posthog'
            }
          />
        </label>
      ))}
      {def.supportsLocalOnly && (
        <label className="flex items-center gap-2 font-public-sans text-[13px] text-night-fg-2">
          <input
            type="checkbox"
            checked={localOnly}
            onChange={(e) => setLocalOnly(e.target.checked)}
            className="h-4 w-4 accent-[#ffb224]"
          />
          Local-only: raw data from this source never leaves your runtime
        </label>
      )}
      {error && <ErrorRow message={error} />}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="ps-btn-primary">
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Connect'}
        </button>
        <button type="button" onClick={onCancel} className="ps-btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

function ConnectorCard({
  def,
  existing,
  workspaceId,
  onChanged,
}: {
  def: ConnectorDef;
  existing: Connection | null;
  workspaceId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState('');

  async function runTest() {
    if (!existing || busy) return;
    setBusy(true);
    setTestResult('');
    try {
      const result = await testConnection(existing.id);
      setTestResult(result.ok ? `Connected: ${result.detail}` : `Failed: ${result.detail}`);
      track('connection_tested', { provider: def.provider, ok: result.ok });
      onChanged();
    } catch (e) {
      setTestResult(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || busy) return;
    setBusy(true);
    try {
      await deleteConnection(existing.id);
      track('connection_removed', { provider: def.provider });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const statusDot = !existing
    ? 'bg-night-4'
    : existing.status === 'connected'
      ? 'bg-signal'
      : existing.status === 'error'
        ? 'bg-bad'
        : 'bg-warn';

  return (
    <li className="ps-card flex flex-col gap-2 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-3 font-public-sans text-[15px] font-semibold text-night-fg">
            <span
              className={`inline-block h-[7px] w-[7px] rounded-pill ${statusDot}`}
              aria-hidden
            />
            {def.name}
            {existing?.local_only && (
              <span className="font-public-mono text-[10px] uppercase tracking-[0.12em] text-signal">
                local-only
              </span>
            )}
          </p>
          <p className="m-0 mt-1 pl-[19px] font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
            {def.blurb}
          </p>
          {testResult && (
            <p className="m-0 mt-1 pl-[19px] font-public-mono text-[11px] text-night-fg-3">
              {testResult}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {def.implemented ? (
            existing ? (
              <>
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={busy}
                  className="ps-btn-ghost"
                >
                  {busy ? 'Testing…' : 'Test'}
                </button>
                <button type="button" onClick={() => setEditing(!editing)} className="ps-btn-ghost">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="ps-btn-ghost"
                >
                  Remove
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setEditing(true)} className="ps-btn-primary">
                Connect
              </button>
            )
          ) : (
            <span className="font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
              on the roadmap
            </span>
          )}
        </div>
      </div>
      {editing && (
        <ConnectForm
          def={def}
          existing={existing}
          workspaceId={workspaceId}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </li>
  );
}

export function ConnectionsPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchConnections(workspaceId), [workspaceId]);
  const { data, loading, error, reload } = usePageData(fetcher);
  const connections = data ?? [];

  const implemented = CONNECTORS.filter((c) => c.implemented);
  const roadmap = CONNECTORS.filter((c) => !c.implemented);

  return (
    <div>
      <PageHeader
        title="Connections"
        sub="Read-only keys, stored server-side and never shown again. Local-only sources sync findings, never raw data."
      />
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {implemented.map((def) => (
              <ConnectorCard
                key={def.provider}
                def={def}
                existing={connections.find((c) => c.provider === def.provider) ?? null}
                workspaceId={workspaceId}
                onChanged={reload}
              />
            ))}
          </ul>
          <Section title="On the roadmap">
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {roadmap.map((def) => (
                <ConnectorCard
                  key={def.provider}
                  def={def}
                  existing={null}
                  workspaceId={workspaceId}
                  onChanged={reload}
                />
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
