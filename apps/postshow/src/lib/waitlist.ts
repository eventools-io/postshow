export type WaitlistResult = 'joined' | 'invalid' | 'error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(trimmed);
}

export async function joinWaitlist(email: string): Promise<WaitlistResult> {
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) {
    return 'invalid';
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return 'error';
  }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/join_postshow_waitlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ p_email: trimmed, p_source: 'landing' }),
    });
    return response.ok ? 'joined' : 'error';
  } catch {
    return 'error';
  }
}
