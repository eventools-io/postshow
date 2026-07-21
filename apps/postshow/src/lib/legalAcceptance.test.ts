import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POSTSHOW_PRIVACY_VERSION,
  POSTSHOW_TERMS_VERSION,
  recordPostshowLegalAcceptance,
  signupLegalAcceptanceMetadata,
} from './legalAcceptance';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));

const acceptance = {
  terms_version: POSTSHOW_TERMS_VERSION,
  privacy_version: POSTSHOW_PRIVACY_VERSION,
  context: 'workspace_creation',
  accepted_at: '2026-07-21T12:00:00.000Z',
};

describe('legal acceptance client', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('puts only the exact versioned signup proof in Auth metadata', () => {
    expect(signupLegalAcceptanceMetadata()).toEqual({
      postshow_legal_acceptance: {
        terms_version: '2026-07-21',
        privacy_version: '2026-07-21',
        context: 'signup',
      },
    });
  });

  it('records an exact existing-user acceptance and validates the durable acknowledgement', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, acceptance }, error: null });

    await expect(recordPostshowLegalAcceptance('workspace_creation')).resolves.toEqual(acceptance);
    expect(mocks.rpc).toHaveBeenCalledWith('postshow_record_legal_acceptance', {
      p_terms_version: '2026-07-21',
      p_privacy_version: '2026-07-21',
      p_context: 'workspace_creation',
    });
  });

  it.each([
    null,
    true,
    [],
    {},
    { ok: true },
    { ok: false, acceptance },
    { ok: true, acceptance, extra: true },
    { ok: true, acceptance: { ...acceptance, accepted_at: 'not-a-date' } },
    { ok: true, acceptance: { ...acceptance, context: 'invitation_acceptance' } },
    { ok: true, acceptance: { ...acceptance, terms_version: 'old' } },
    { ok: true, acceptance: { ...acceptance, extra: true } },
  ])('fails closed on a malformed durable acknowledgement %#', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(recordPostshowLegalAcceptance('workspace_creation')).rejects.toThrow(/invalid/i);
  });

  it('does not enumerate provider failures and permits an idempotent user retry', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'private database detail' } })
      .mockResolvedValueOnce({ data: { ok: true, acceptance }, error: null });

    await expect(recordPostshowLegalAcceptance('workspace_creation')).rejects.toThrow(
      'Postshow could not durably record your legal acceptance. No action was taken.'
    );
    await expect(recordPostshowLegalAcceptance('workspace_creation')).resolves.toEqual(acceptance);
  });
});
