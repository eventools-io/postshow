const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const NUMBER = /^[1-9][0-9]{0,19}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

const PATH_SEGMENT: Record<string, string> = {
  pull_request: 'pull',
  commit: 'commit',
  issue: 'issues',
};

/** Builds the link from the repository and identifier the reference table
 * stores, never from a URL a provider or a model supplied. An identifier that
 * does not match what the table accepts gets no link rather than a guessed one,
 * which is also what a legacy or malformed row degrades to. */
export function githubObjectUrl(
  repo: string | null,
  objectType: string,
  objectId: string | null
): string | null {
  const segment = PATH_SEGMENT[objectType];
  if (!segment || !repo || !objectId || !REPO.test(repo)) return null;
  const valid = objectType === 'commit' ? COMMIT_SHA.test(objectId) : NUMBER.test(objectId);
  if (!valid) return null;
  return `https://github.com/${repo}/${segment}/${objectId}`;
}

/** Short display text for a repository object. A commit shows an abbreviated
 * sha because a full one crowds the dossier, but the link and the stored
 * reference both keep every character. */
export function githubObjectLabel(objectType: string, objectId: string): string {
  if (objectType === 'commit') return `commit ${objectId.slice(0, 7)}`;
  return objectType === 'pull_request' ? `pull #${objectId}` : `issue #${objectId}`;
}
