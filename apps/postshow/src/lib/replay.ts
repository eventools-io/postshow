import type { PosthogReplayConfig } from './types';
import { DEFAULT_POSTHOG_HOST } from './connectors';

const SESSION_ID = /^[A-Za-z0-9_-]{6,160}$/;

export function posthogReplayConfig(meta: Record<string, unknown>): PosthogReplayConfig | null {
  const projectId = String(meta.project_id ?? '');
  if (!/^[0-9]{1,20}$/.test(projectId)) return null;
  try {
    const url = new URL(String(meta.host ?? DEFAULT_POSTHOG_HOST));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null;
    }
    return { origin: url.origin, projectId };
  } catch {
    return null;
  }
}

export function posthogReplayUrl(
  config: PosthogReplayConfig | null,
  sessionId: string
): string | null {
  if (!config || !SESSION_ID.test(sessionId) || !/^[0-9]{1,20}$/.test(config.projectId)) {
    return null;
  }
  try {
    const origin = new URL(config.origin);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      (origin.pathname !== '/' && origin.pathname !== '')
    ) {
      return null;
    }
    return `${origin.origin}/project/${config.projectId}/replay/${encodeURIComponent(sessionId)}`;
  } catch {
    return null;
  }
}
