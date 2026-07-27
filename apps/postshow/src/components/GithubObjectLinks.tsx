import type { IncidentReference } from '@/lib/types';
import { githubObjectLabel, githubObjectUrl } from '@/lib/githubObjects';

export function GithubObjectLinks({ references }: { references: IncidentReference[] }) {
  const seen = new Set<string>();
  const links = references.flatMap((reference) => {
    const href = githubObjectUrl(
      reference.github_repo,
      reference.object_type,
      reference.github_object_id
    );
    if (!href || !reference.github_object_id || seen.has(href)) return [];
    seen.add(href);
    return [
      {
        href,
        label: githubObjectLabel(reference.object_type, reference.github_object_id),
      },
    ];
  });
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" aria-label="GitHub code evidence">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm border border-night-4 px-1.5 py-0.5 font-public-mono text-[9px] text-night-fg-2 hover:border-signal hover:text-night-fg"
        >
          {link.label} ↗
        </a>
      ))}
    </div>
  );
}
