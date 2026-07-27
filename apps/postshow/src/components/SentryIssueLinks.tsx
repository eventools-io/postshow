import type { IncidentReference, SentryIssueConfig } from '@/lib/types';
import { sentryIssueUrl } from '@/lib/sentryIssues';

export function SentryIssueLinks({
  references,
  config,
}: {
  references: IncidentReference[];
  config: SentryIssueConfig | null;
}) {
  // A GitHub row leaves this column null, so the shape check happens here as
  // well as in the caller's provider filter.
  const issueIds = references.flatMap((reference) =>
    reference.sentry_issue_id ? [reference.sentry_issue_id] : []
  );
  const links = [...new Set(issueIds)].flatMap((issueId) => {
    const href = sentryIssueUrl(config, issueId);
    return href ? [{ issueId, href }] : [];
  });
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" aria-label="Sentry issue evidence">
      {links.map((link) => (
        <a
          key={link.issueId}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm border border-night-4 px-1.5 py-0.5 font-public-mono text-[9px] text-night-fg-2 hover:border-signal hover:text-night-fg"
        >
          issue {link.issueId} ↗
        </a>
      ))}
    </div>
  );
}
