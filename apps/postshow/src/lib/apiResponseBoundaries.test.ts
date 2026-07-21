import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInboxAction, previewInboxAction, testConnection } from './api';

const mocks = vi.hoisted(() => ({
  functionInvoke: vi.fn(),
  postshowInvoke: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: mocks.functionInvoke } },
}));

vi.mock('./functionClient', () => ({
  invokePostshowFunction: mocks.postshowInvoke,
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const confirmationId = '33333333-3333-4333-8333-333333333333';
const receiptId = '44444444-4444-4444-8444-444444444444';
const confirmationToken = `pca_${'a'.repeat(64)}`;

function validPreview() {
  return {
    ok: true,
    confirmation_id: confirmationId,
    confirmation_token: confirmationToken,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    preview: {
      workspace_id: workspaceId,
      item_id: itemId,
      revision: 4,
      action_type: 'email',
      title: 'Seat limit reached',
      body: 'Would you like help adding seats?',
      evidence: 'Seat modal opened nine times.',
      action_config: { subject: 'More seats' },
      destination: 'owner@example.com',
      sender: 'team@example.com',
    },
  };
}

describe('connection-test response boundary', () => {
  beforeEach(() => mocks.functionInvoke.mockReset());

  it.each([
    [true, 'connected'],
    [false, 'provider rejected the credential'],
  ])('accepts the exact cloud AdapterResult with ok=%s', async (ok, detail) => {
    mocks.functionInvoke.mockResolvedValue({ data: { ok, detail }, error: null });
    await expect(testConnection('connection-1')).resolves.toEqual({ ok, detail });
  });

  it.each([
    null,
    [],
    'truncated {',
    42,
    {},
    { ok: 'true', detail: 'connected' },
    { ok: true },
    { ok: true, detail: 7 },
    { ok: true, detail: '' },
    { ok: true, detail: 'x'.repeat(1001) },
    { ok: true, detail: 'connected', extra: true },
  ])('rejects malformed 2xx connection result %#', async (data) => {
    mocks.functionInvoke.mockResolvedValue({ data, error: null });
    await expect(testConnection('connection-1')).rejects.toThrow(
      'Connection test returned an invalid response.'
    );
  });

  it('never echoes malformed response content in its error', async () => {
    const secret = 'phx_must_not_escape';
    mocks.functionInvoke.mockResolvedValue({
      data: { ok: 'true', detail: secret },
      error: null,
    });
    const error = await testConnection('connection-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secret);
  });
});

describe('irreversible action response boundaries', () => {
  beforeEach(() => mocks.postshowInvoke.mockReset());

  it('accepts the exact preview contract emitted by postshow-action', async () => {
    const response = validPreview();
    mocks.postshowInvoke.mockResolvedValue(response);
    await expect(previewInboxAction(itemId, 4)).resolves.toEqual({
      confirmation_id: response.confirmation_id,
      confirmation_token: response.confirmation_token,
      expires_at: response.expires_at,
      preview: response.preview,
    });
  });

  it.each([
    null,
    [],
    'truncated {',
    {},
    { ...validPreview(), ok: 'true' },
    { ...validPreview(), confirmation_id: 'not-a-uuid' },
    { ...validPreview(), confirmation_token: 'pca_bad' },
    { ...validPreview(), expires_at: 'not-a-date' },
    { ...validPreview(), expires_at: new Date(Date.now() - 1_000).toISOString() },
    { ...validPreview(), expires_at: new Date(Date.now() + 11 * 60_000).toISOString() },
    { ...validPreview(), extra: true },
    { ...validPreview(), preview: [] },
    { ...validPreview(), preview: { ...validPreview().preview, item_id: workspaceId } },
    { ...validPreview(), preview: { ...validPreview().preview, revision: 5 } },
    { ...validPreview(), preview: { ...validPreview().preview, action_type: 'shell_command' } },
    { ...validPreview(), preview: { ...validPreview().preview, title: 'x'.repeat(301) } },
    { ...validPreview(), preview: { ...validPreview().preview, action_config: [] } },
    {
      ...validPreview(),
      preview: { ...validPreview().preview, action_config: { subject: 'x'.repeat(201) } },
    },
    { ...validPreview(), preview: { ...validPreview().preview, unexpected: true } },
  ])('rejects malformed 2xx preview result %#', async (response) => {
    mocks.postshowInvoke.mockResolvedValue(response);
    await expect(previewInboxAction(itemId, 4)).rejects.toThrow(/invalid/i);
  });

  it('accepts the exact execution receipt emitted by postshow-action', async () => {
    mocks.postshowInvoke.mockResolvedValue({
      ok: true,
      detail: 'email sent',
      receipt_id: receiptId,
    });
    await expect(executeInboxAction(confirmationToken)).resolves.toEqual({
      ok: true,
      detail: 'email sent',
      receipt_id: receiptId,
    });
  });

  it.each([
    null,
    [],
    'truncated {',
    {},
    { ok: 'true', detail: 'email sent', receipt_id: receiptId },
    { ok: true, detail: 'email sent' },
    { ok: true, detail: 7, receipt_id: receiptId },
    { ok: true, detail: '', receipt_id: receiptId },
    { ok: true, detail: 'x'.repeat(1001), receipt_id: receiptId },
    { ok: true, detail: 'email sent', receipt_id: 'not-a-uuid' },
    { ok: true, detail: 'email sent', receipt_id: receiptId, extra: true },
  ])('rejects malformed 2xx execution result %#', async (response) => {
    mocks.postshowInvoke.mockResolvedValue(response);
    await expect(executeInboxAction(confirmationToken)).rejects.toThrow();
  });
});
