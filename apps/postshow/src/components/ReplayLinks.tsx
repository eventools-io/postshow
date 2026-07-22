import type { PosthogReplayConfig } from '@/lib/types';
import { posthogReplayUrl } from '@/lib/replay';

export function ReplayLinks({
  sessionIds,
  config,
}: {
  sessionIds: string[];
  config: PosthogReplayConfig | null;
}) {
  const links = [...new Set(sessionIds)].flatMap((sessionId) => {
    const href = posthogReplayUrl(config, sessionId);
    return href ? [{ sessionId, href }] : [];
  });
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Session replay evidence">
      {links.map((link, index) => (
        <a
          key={link.sessionId}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm border border-night-4 px-2 py-1 font-public-mono text-[10px] text-night-fg-2 hover:border-signal hover:text-night-fg"
        >
          replay {index + 1} ↗
        </a>
      ))}
    </div>
  );
}
