import { useCallback, useState, type FormEvent } from 'react';
import { useWorkspace } from '@/state/WorkspaceContext';
import {
  fetchConnections,
  fetchWorkspacePermissions,
  upsertConnection,
  deleteConnection,
  testConnection,
} from '@/lib/api';
import { usePageData } from '@/lib/usePageData';
import { CONNECTORS, canonicalConnectionMeta, type ConnectorDef } from '@/lib/connectors';
import { PageHeader, LoadingRow, ErrorRow, Section } from '@/components/page';
import { track } from '@/lib/analytics';
import type { Connection } from '@/lib/types';

export function ConnectForm({
  def,
  existing,
  workspaceId,
  canManage,
  onDone,
  onCancel,
}: {
  def: ConnectorDef;
  existing: Connection | null;
  workspaceId: string;
  canManage: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const deviceOnly = def.provider === 'postgres';
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of def.metaFields) {
      initial[field.key] = String((existing?.meta as Record<string, unknown>)?.[field.key] ?? '');
    }
    return initial;
  });
  const [localOnly, setLocalOnly] = useState(deviceOnly || (existing?.local_only ?? false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let targetChanged = false;
  if (existing) {
    try {
      targetChanged =
        JSON.stringify(canonicalConnectionMeta(def.provider, existing.meta)) !==
        JSON.stringify(canonicalConnectionMeta(def.provider, values));
    } catch {
      // If either target cannot be canonicalized, retaining a stored
      // credential is never safe. Submit will surface the precise error.
      targetChanged = true;
    }
  }
  const credentialRequired = !existing || existing.local_only || targetChanged;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canManage) return;
    setBusy(true);
    setError('');
    try {
      if (localOnly) {
        throw new Error(
          'Local-only credentials must be configured on the device that runs Postshow.'
        );
      }
      const missingMeta = def.metaFields.find(
        (field) => field.required === true && !values[field.key]?.trim()
      );
      if (missingMeta) throw new Error(`${missingMeta.label} is required.`);

      const canonicalMeta = canonicalConnectionMeta(def.provider, values);
      const existingCanonicalMeta = existing
        ? canonicalConnectionMeta(def.provider, existing.meta)
        : {};
      const canonicalTargetChanged =
        Boolean(existing) &&
        JSON.stringify(existingCanonicalMeta) !== JSON.stringify(canonicalMeta);
      const mustReenterCredential = !existing || existing.local_only || canonicalTargetChanged;
      const secret: Record<string, unknown> = {};
      let hasSecret = false;
      for (const field of def.secretFields) {
        const value = values[field.key]?.trim();
        if (value) {
          secret[field.key] = value;
          hasSecret = true;
        }
      }
      if (mustReenterCredential && def.secretFields.some((field) => !values[field.key]?.trim())) {
        throw new Error(
          'Re-enter the credential before binding this connection to a new target. Postshow never carries a stored credential to a different target.'
        );
      }
      // The database intentionally compares raw JSON before retaining a Vault
      // reference. For a semantic no-op with a blank secret, send the original
      // bytes exactly; otherwise a harmless normalization could erase the key.
      const meta =
        existing && !existing.local_only && !canonicalTargetChanged && !hasSecret
          ? existing.meta
          : canonicalMeta;
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
      {!localOnly &&
        [...def.secretFields, ...def.metaFields].map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="ps-label">
              {field.label}
              {def.secretFields.includes(field) && existing
                ? credentialRequired
                  ? ' (required to bind this target)'
                  : ' (leave blank to keep current)'
                : null}
            </span>
            <input
              type={field.kind === 'secret' ? 'password' : 'text'}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              className="ps-input"
              autoComplete="off"
              required={field.kind === 'secret' ? credentialRequired : field.required === true}
              disabled={!canManage}
            />
          </label>
        ))}
      {def.supportsLocalOnly && !deviceOnly && (
        <label className="flex items-center gap-2 font-public-sans text-[13px] text-night-fg-2">
          <input
            type="checkbox"
            checked={localOnly}
            onChange={(e) => setLocalOnly(e.target.checked)}
            className="h-4 w-4 accent-[#ffb224]"
            disabled={!canManage}
          />
          Configure this source on a device instead
        </label>
      )}
      {localOnly ? (
        <div className="rounded-sm border border-signal/30 bg-night-2 p-3">
          <p className="m-0 font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
            {deviceOnly
              ? 'Postgres is always device-only. The web app never accepts its connection string or query. '
              : 'The web app will not collect, transmit, or delete device credentials. '}
            Run <code className="font-public-mono text-night-fg">npx postshow init</code> on the
            device that will execute this source. Source data never syncs to Postshow; gathered
            evidence may be sent to the model provider you choose on that device.
          </p>
          {existing && !existing.local_only ? (
            <p className="m-0 mt-2 font-public-sans text-[12px] text-warn">
              {deviceOnly
                ? 'This legacy cloud connection cannot be used. Production migration removes any stored Postgres credential; remove this record after configuring the device.'
                : 'Your existing cloud credential remains unchanged until device setup is verified and you explicitly remove this cloud connection.'}
            </p>
          ) : null}
        </div>
      ) : null}
      {error && <ErrorRow message={error} />}
      <div className="flex gap-2">
        {!localOnly ? (
          <button type="submit" disabled={busy || !canManage} className="ps-btn-primary">
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Connect'}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} className="ps-btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ConnectorCard({
  def,
  existing,
  workspaceId,
  canManage,
  onChanged,
}: {
  def: ConnectorDef;
  existing: Connection | null;
  workspaceId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [confirmSlackTest, setConfirmSlackTest] = useState(false);

  async function runTest(sendTestMessage = false) {
    if (!canManage || !existing || busy) return;
    setBusy(true);
    setTestResult('');
    try {
      const result = await testConnection(existing.id, sendTestMessage);
      setTestResult(result.ok ? `Connected: ${result.detail}` : `Failed: ${result.detail}`);
      track('connection_tested', { provider: def.provider, ok: result.ok });
      onChanged();
      setConfirmSlackTest(false);
    } catch (e) {
      setTestResult(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!canManage || !existing || busy) return;
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
            canManage ? (
              existing ? (
                <>
                  {!existing.local_only && def.provider !== 'postgres' ? (
                    <button
                      type="button"
                      onClick={() =>
                        def.provider === 'slack' ? setConfirmSlackTest(true) : void runTest()
                      }
                      disabled={busy}
                      className="ps-btn-ghost"
                    >
                      {busy ? 'Testing…' : 'Test'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setEditing(!editing)}
                    className="ps-btn-ghost"
                  >
                    {existing.local_only || def.provider === 'postgres' ? 'Device setup' : 'Edit'}
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
                  {def.provider === 'postgres' ? 'Set up on device' : 'Connect'}
                </button>
              )
            ) : null
          ) : (
            <span className="font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
              on the roadmap
            </span>
          )}
        </div>
      </div>
      {editing && canManage && (
        <ConnectForm
          def={def}
          existing={existing}
          workspaceId={workspaceId}
          canManage={canManage}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {confirmSlackTest && canManage ? (
        <div className="rounded-sm border border-warn/40 bg-night-2 p-3" role="alertdialog">
          <p className="m-0 font-public-sans text-[12px] leading-[1.55] text-night-fg-2">
            This test posts a visible “Postshow connected” message to the configured Slack channel.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void runTest(true)}
              disabled={busy}
              className="ps-btn-primary"
            >
              {busy ? 'Posting…' : 'Post test message'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmSlackTest(false)}
              disabled={busy}
              className="ps-btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function ConnectionsPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? '';
  const fetcher = useCallback(() => fetchConnections(workspaceId), [workspaceId]);
  const { data, loading, error, reload } = usePageData(fetcher);
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
  const canManage = permissionsReady && permissions.manage_settings;
  const connections = (data ?? []).filter((connection) => connection.workspace_id === workspaceId);

  const implemented = CONNECTORS.filter((c) => c.implemented);
  const roadmap = CONNECTORS.filter((c) => !c.implemented);

  return (
    <div>
      <PageHeader
        title="Connections"
        sub="Cloud credentials are write-only. Device-only credentials and source data never sync to Postshow; evidence may go to your chosen model provider."
      />
      {permissionsLoading ? (
        <p className="mb-4 font-public-sans text-[12px] text-night-fg-3" role="status">
          Checking connection permissions… Shared connection controls remain locked.
        </p>
      ) : permissionsError ? (
        <div className="mb-4 flex flex-wrap items-center gap-3" role="alert">
          <span className="font-public-sans text-[12px] text-bad">
            Connection permissions could not be verified. Shared connection controls remain locked.
          </span>
          <button type="button" onClick={reloadPermissions} className="ps-btn-ghost">
            Retry permission check
          </button>
        </div>
      ) : permissionsReady && !canManage ? (
        <p className="mb-4 font-public-sans text-[12px] text-night-fg-2">
          Connections are read-only for your workspace role. Ask an owner or admin to add, edit,
          test, or remove a connection.
        </p>
      ) : null}
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {implemented.map((def) => (
              <ConnectorCard
                key={`${workspaceId}:${def.provider}`}
                def={def}
                existing={connections.find((c) => c.provider === def.provider) ?? null}
                workspaceId={workspaceId}
                canManage={canManage}
                onChanged={reload}
              />
            ))}
          </ul>
          <Section title="On the roadmap">
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {roadmap.map((def) => (
                <ConnectorCard
                  key={`${workspaceId}:${def.provider}`}
                  def={def}
                  existing={null}
                  workspaceId={workspaceId}
                  canManage={canManage}
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
