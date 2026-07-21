import { supabase } from './supabase';

export const POSTSHOW_TERMS_VERSION = '2026-07-21';
export const POSTSHOW_PRIVACY_VERSION = '2026-07-21';
export const POSTSHOW_LEGAL_EFFECTIVE_DATE = 'July 21, 2026';

export type PostshowLegalAcceptanceContext =
  | 'signup'
  | 'workspace_creation'
  | 'invitation_acceptance';

export interface PostshowLegalAcceptance {
  terms_version: typeof POSTSHOW_TERMS_VERSION;
  privacy_version: typeof POSTSHOW_PRIVACY_VERSION;
  context: PostshowLegalAcceptanceContext;
  accepted_at: string;
}

const LEGAL_ACCEPTANCE_RPC = 'postshow_record_legal_acceptance';

function legalProof(context: PostshowLegalAcceptanceContext) {
  return {
    terms_version: POSTSHOW_TERMS_VERSION,
    privacy_version: POSTSHOW_PRIVACY_VERSION,
    context,
  } as const;
}

export function signupLegalAcceptanceMetadata() {
  return { postshow_legal_acceptance: legalProof('signup') } as const;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Legal acceptance service returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function parseAcceptance(
  value: unknown,
  context: Exclude<PostshowLegalAcceptanceContext, 'signup'>
): PostshowLegalAcceptance {
  const payload = record(value, 'response');
  const payloadKeys = Object.keys(payload).sort();
  if (
    payloadKeys.length !== 2 ||
    payloadKeys[0] !== 'acceptance' ||
    payloadKeys[1] !== 'ok' ||
    payload.ok !== true
  ) {
    throw new Error('Legal acceptance service returned an invalid response.');
  }

  const acceptance = record(payload.acceptance, 'record');
  const acceptanceKeys = Object.keys(acceptance).sort();
  if (
    acceptanceKeys.length !== 4 ||
    acceptanceKeys[0] !== 'accepted_at' ||
    acceptanceKeys[1] !== 'context' ||
    acceptanceKeys[2] !== 'privacy_version' ||
    acceptanceKeys[3] !== 'terms_version' ||
    acceptance.terms_version !== POSTSHOW_TERMS_VERSION ||
    acceptance.privacy_version !== POSTSHOW_PRIVACY_VERSION ||
    acceptance.context !== context ||
    typeof acceptance.accepted_at !== 'string' ||
    !Number.isFinite(Date.parse(acceptance.accepted_at))
  ) {
    throw new Error('Legal acceptance service returned an invalid record.');
  }

  return {
    terms_version: POSTSHOW_TERMS_VERSION,
    privacy_version: POSTSHOW_PRIVACY_VERSION,
    context,
    accepted_at: acceptance.accepted_at,
  };
}

export async function recordPostshowLegalAcceptance(
  context: Exclude<PostshowLegalAcceptanceContext, 'signup'>
): Promise<PostshowLegalAcceptance> {
  const { data, error } = await supabase.rpc(LEGAL_ACCEPTANCE_RPC, {
    p_terms_version: POSTSHOW_TERMS_VERSION,
    p_privacy_version: POSTSHOW_PRIVACY_VERSION,
    p_context: context,
  });
  if (error) {
    throw new Error(
      'Postshow could not durably record your legal acceptance. No action was taken.'
    );
  }
  return parseAcceptance(data, context);
}
