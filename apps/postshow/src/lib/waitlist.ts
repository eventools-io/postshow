export type WaitlistResult = 'joined' | 'invalid' | 'error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;
const MAX_WAITLIST_RESPONSE_BYTES = 1_024;

async function readBoundedJsonObject(response: Response): Promise<Record<string, unknown> | null> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_WAITLIST_RESPONSE_BYTES
  ) {
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_WAITLIST_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();

    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(trimmed);
}

export async function joinWaitlist(
  email: string,
  turnstileToken: string,
  requestId: string
): Promise<WaitlistResult> {
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) {
    return 'invalid';
  }
  if (!turnstileToken || !requestId) return 'error';
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const functionName =
    import.meta.env.VITE_POSTSHOW_WAITLIST_FUNCTION?.trim() || 'postshow-waitlist';
  if (!supabaseUrl || !supabaseKey) {
    return 'error';
  }
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${encodeURIComponent(functionName)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
        },
        body: JSON.stringify({
          request_id: requestId,
          email: trimmed,
          turnstile_token: turnstileToken,
        }),
      }
    );
    if (response.status !== 202) return 'error';
    const payload = await readBoundedJsonObject(response);
    return payload !== null && Object.keys(payload).length === 1 && payload.ok === true
      ? 'joined'
      : 'error';
  } catch {
    return 'error';
  }
}
