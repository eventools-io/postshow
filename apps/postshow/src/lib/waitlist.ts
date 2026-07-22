export type WaitlistResult = 'joined' | 'invalid' | 'error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_EMAIL_LENGTH = 320;
const NETLIFY_FORM_NAME = 'beta-signup';
const NETLIFY_FORM_PATH = '/__forms.html';

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(trimmed);
}

export async function joinWaitlist(email: string, requestId: string): Promise<WaitlistResult> {
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) {
    return 'invalid';
  }
  if (!UUID_PATTERN.test(requestId)) return 'error';

  try {
    const response = await fetch(NETLIFY_FORM_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        'form-name': NETLIFY_FORM_NAME,
        email: trimmed,
        source: 'landing',
        request_id: requestId,
      }).toString(),
    });
    return response.ok ? 'joined' : 'error';
  } catch {
    return 'error';
  }
}
