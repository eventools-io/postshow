const PREFIX = 'postshow.operation.';
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function idempotencyKey(scope: string): string {
  const key = `${PREFIX}${scope}`;
  const existing = storage()?.getItem(key) ?? memory.get(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  memory.set(key, created);
  try {
    storage()?.setItem(key, created);
  } catch {
    // In-memory replay safety still covers this tab when storage is unavailable.
  }
  return created;
}

export function clearIdempotencyKey(scope: string): void {
  const key = `${PREFIX}${scope}`;
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing else to clear.
  }
}
