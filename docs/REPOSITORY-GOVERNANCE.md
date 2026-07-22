# Repository governance

This document separates controls enforced by source from GitHub settings that must
be enabled and read back before the first supported public release.

## Enforced in source

Run the offline governance check after `pnpm install`:

```sh
pnpm governance:check
```

The check verifies required policy and support files, canonical contact and package
metadata, identical Eventools LLC MIT license copies, an allowlist of production
dependency license expressions, immutable third-party GitHub Action references,
immutable Docker action references, workflow-level least-privilege defaults, and
the absence of `pull_request_target` and `workflow_run` triggers. It also requires
the two non-executable JSON-LD blocks in the site shell to match the exact SHA-256
hashes in the deployed Content Security Policy and rejects any other inline script.

The site-only production build runs the same controls against the built HTML while
scoping the license inventory to `@eventools/postshow` and its production dependency
closure. This keeps a web deploy independent of unshipped desktop, CLI, and build
tool dependencies. The default check and the full repository build continue to
inventory every workspace's production dependencies.

If pnpm reports that a cached package-index file is missing, the inventory repairs
the frozen install once with dependency lifecycle scripts disabled, then retries.
Other inventory errors and any unapproved license expression still fail the check.

Dependabot is configured for weekly pnpm-workspace and GitHub Actions updates.
CODEOWNERS names the two current repository administrators, and issue and
pull-request templates route sensitive reports away from public issues.

## GitHub settings required before a supported release

These controls cannot be guaranteed by files in a clone. An administrator must
enable them and verify the saved state through GitHub's API or settings UI:

1. Protect `main` with pull requests, current required CI checks, conversation
   resolution, blocked force pushes, blocked deletion, and one CODEOWNER review.
   Confirm that both named owners remain eligible so a pull-request author can obtain
   an independent review. Read back the exact ruleset JSON, including
   `bypass_actors`. Do not accept broad RepositoryRole/write or OrganizationAdmin
   always-bypass entries. If the API omits bypass actors because the caller lacks
   administrative visibility, treat the readback as incomplete.
2. Keep the default Actions token permission read-only. Do not allow workflows to
   create or approve pull requests. Require approval for workflows from untrusted
   fork contributors.
3. Restrict Actions to GitHub-owned actions and the explicitly approved, SHA-pinned
   actions already present in this repository.
4. Enable the dependency graph, Dependabot alerts, Dependabot security updates,
   secret scanning, and push protection when the repository's visibility and GitHub
   plan make each control available.
5. Add a dependency-review workflow only after the repository is public or GitHub
   Code Security or GitHub Advanced Security is enabled for the private repository.
   A workflow that always fails because the Dependency Review API is unavailable is
   not a control.
6. Protect stable `vX.Y.Z` tags from deletion or replacement with the same narrow
   bypass standard. Before release enablement, land the hardened workflow at its
   distinct workflow path, confirm that its new workflow ID is active on the default
   branch, and disable historical `Release` workflow ID `316997874`. A tag loads the
   workflow definition from the tagged commit, so leaving the historical ID active
   would leave older, weaker release logic dispatchable. Configure the release
   environments and their reviewers according to the release runbook, then prove
   the exact saved settings before attaching credentials.
7. Enable private vulnerability reporting when the repository is public. Confirm
   that GitHub renders [SECURITY.md](../SECURITY.md) as the repository security
   policy and that the security and support contact routes are reachable.

Record the readback evidence with the release-acceptance record. A green workflow
does not prove that a repository setting exists.
