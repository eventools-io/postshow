import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

function canonicalEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/**
 * Returns the current bearer for passwordless/OAuth/MFA users, or performs an
 * interactive password sign-in when a password is supplied. The destructive
 * service remains the authority for JWT signature, actor, iat, and AMR freshness.
 */
export async function destructiveAccessToken(session: Session, password: string): Promise<string> {
  if (password.length === 0) {
    if (!session.access_token) throw new Error('Fresh sign-in proof is missing.');
    return session.access_token;
  }

  const email = canonicalEmail(session.user.email);
  if (!email) throw new Error('This account has no verified email for password reauthentication.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Password reauthentication failed.');
  if (
    !data.session ||
    data.session.user.id !== session.user.id ||
    canonicalEmail(data.session.user.email) !== email ||
    !data.session.access_token
  ) {
    throw new Error('Reauthentication returned a different account. Sign out and retry.');
  }
  return data.session.access_token;
}

export const REAUTHENTICATION_GUIDANCE =
  'Your interactive sign-in proof is not fresh enough. Enter your password if this account has one, or sign out and sign in again with OAuth, a magic link, SSO, MFA, or your usual method, then return within 10 minutes.';
