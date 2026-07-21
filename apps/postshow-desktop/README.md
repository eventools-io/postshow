# Postshow desktop

The menu-bar agent. An Electron shell around the postshow web app that adds what a browser tab cannot: a tray presence, a background scheduler that runs local jobs with catch-up on wake, and the same local runtime the CLI uses.

MIT licensed, like the rest of Postshow's client surfaces.

## How it fits together

- Packaged builds always render exactly `https://postshow.io`, so desktop and web are the same synced workspace. Development builds may override the URL only with `http://localhost:5176` or `http://127.0.0.1:5176`.
- The shell shares `~/.postshow/config.json` with the CLI. `npx postshow init` configures both. The file contains only non-secret settings and opaque references; access tokens, model keys, and connector credentials live in macOS Keychain or Windows Credential Manager.
- The scheduler ticks every 15 minutes, on launch, and on wake from sleep. Due-ness is a persisted next-due timestamp per job, so a closed laptop just catches up when it opens. Runs execute with your local keys or Ollama and sync derived findings only.
- A small ledger (`~/.postshow/desktop.db`, `node:sqlite` - no native module rebuilds) records what ran on this machine for the tray menu.
- Stable releases check the public `eventools-io/postshow` GitHub Releases channel every six hours and after wake. Updates run only from packaged macOS/Windows builds whose current signature is trusted (Developer ID + Gatekeeper/staple on macOS, valid Authenticode on Windows). Development, ad-hoc, unsigned, prerelease, equal-version, and downgrade candidates are refused. Downloads are visible in the tray; a user must explicitly choose **Restart and install**. Failed checks expose an explicit retry action.
- **Export privacy-safe diagnostics…** writes an inspectable, mode-0600 JSON bundle selected by the user. It contains only bounded app/runtime versions, coarse config state and counts, update state, and recent run outcomes. It cannot include credentials, connector metadata, workspace/customer identifiers, paths, URLs, prompts, gathered content, logs, or free-form error text.
- Electron's renderer is explicitly isolated and sandboxed with web security enabled, Node.js and webviews disabled, denied permission requests, strict navigation handling, and an origin-validated typed preload. The bridge exposes runtime/update status and only the explicit run, update, install, and diagnostic actions shown by the native shell.

## Develop

```sh
pnpm --filter @eventools/postshow-desktop dev    # loads http://localhost:5176
pnpm --filter @eventools/postshow-desktop test
```

Electron's binary download is gated by pnpm's build-script policy; run `pnpm approve-builds` once locally before `dev` or `dist`.

## Package

```sh
# universal macOS dmg + zip
pnpm --filter @eventools/postshow-desktop dist

# Windows x64 + arm64 NSIS installers
pnpm --filter @eventools/postshow-desktop dist:win
```

Artifacts are named with platform and architecture under `dist/`. The native
credential module is shipped as an unpacked production dependency, with both macOS
universal architectures and Windows x64/arm64 variants locked by pnpm. The two
Windows installers are built in one builder invocation so `latest.yml` contains
the hashes for both exact signed artifacts; macOS emits `latest-mac.yml` alongside
the required ZIP update target.

Local acceptance builds are unsigned and therefore cannot contact the update
channel. Configure two protected GitHub environments before creating a release:

- `release` requires a reviewer, has **prevent self-review** enabled, and has
  exactly one custom deployment policy: the `v*` tag pattern.
- `release-dry-run` has the same reviewer and self-review protections, and has
  exactly one custom deployment policy: the `main` branch. A manual dispatch
  from `main` signs and exercises the artifacts but cannot reach a publication
  job.

For both environments, also turn off **Allow administrators to bypass configured
protection rules** in the GitHub UI. GitHub's environment API does not expose
that switch, so the workflow cannot prove it; this UI check is a mandatory
pre-release control.

The hardened publisher is `.github/workflows/publish-release.yml` and must have
its own active GitHub workflow ID after this change reaches `main`. Before any
stable tag is allowed, disable historical workflow ID `316997874`; the retained
`.github/workflows/release.yml` is only an inert tombstone on the default branch,
but source from an older tagged commit cannot retire its own workflow identity.
Do not treat the publisher as enabled until the new workflow is active and that
historical ID is disabled, every run under it is completed, and both facts are
read back through GitHub.

Store the platform signing credentials below in **both** environments as
environment secrets (not as unprotected repository secrets). The dry run uses
the real signing identities but never receives an npm publishing credential:

- macOS signing plus notarization: `MAC_CSC_LINK`,
  `MAC_CSC_KEY_PASSWORD`, raw P8 contents in `APPLE_API_KEY`,
  `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. The expected team ID is a
  non-secret variable described below.
- Windows code signing: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, and the expected
  certificate identity variables described below.
- GitHub immutable-release policy readback: `RELEASE_ADMIN_READ_TOKEN`, a
  fine-grained PAT limited to this repository with **Administration: read** (and
  no token write permission), issued to an account with repository administrator
  access. The default workflow token cannot read immutable-release policy or the
  complete ruleset bypass list. This credential is used only for those read-only
  endpoints, and the workflow fails if `bypass_actors` is concealed.

The one-time first publication additionally uses `NPM_BOOTSTRAP_TOKEN` in the
`release` environment only. Set `NPM_PUBLISH_MODE=bootstrap`; the workflow
hard-fails unless the package is absent, publishes under an isolated temporary
tag, verifies the signed provenance, creates `latest`, and removes the temporary
tag. A failed-job rerun may recover only that run's exact sole version and bytes.
After the first actual publish, configure npm trusted publishing for organization
`eventools-io`, repository `postshow`, workflow filename
`publish-release.yml`, environment `release`, and allowed action `npm publish`.
Then select **Require two-factor authentication and disallow tokens**, revoke and
remove `NPM_BOOTSTRAP_TOKEN`, and set `NPM_PUBLISH_MODE=trusted`. Every later
publish then uses short-lived GitHub OIDC; trusted mode refuses any bootstrap
token, while bootstrap mode refuses a package containing any other version. No
npm credential belongs in `release-dry-run`.

Define `NPM_PUBLISHER` and `NPM_PUBLISH_MODE` as environment variables in both
environments. `NPM_PUBLISHER` is the exact sole npm owner; bootstrap authenticates
its token as that user, and all modes require the public owner set to remain that
singleton.

Define these additional environment variables in both environments:

- `RELEASE_ADMIN_READER`: the exact GitHub login authenticated by
  `RELEASE_ADMIN_READ_TOKEN`; the workflow rejects a different token identity.
- `APPLE_TEAM_ID`: the expected 10-character Apple signing team identifier.
- `WIN_SIGNER_SHA1`: the expected 40-hex Windows signing-certificate thumbprint.
- `WIN_PUBLISHER_DN`: the signing certificate's complete distinguished name,
  including `CN` and the remaining issued-to fields. Release packaging injects
  this exact value into `win.signtoolOptions.publisherName`; both signed
  architectures and their `app-update.yml` allowlist must match the normalized
  full subject. A common-name-only allowlist is rejected.
- `MAIN_RULESET_ID`, `STABLE_TAG_CREATION_RULESET_ID`, and
  `STABLE_TAG_IMMUTABILITY_RULESET_ID`: the numeric IDs of the active `main`,
  stable-tag creation, and stable-tag immutability rulesets. The workflow fetches
  those exact IDs; names alone are not trusted configuration.
- `STABLE_TAG_BYPASS_TEAM_ID`: the numeric GitHub team ID for the sole stable-tag
  creation bypass. The `main` and immutability rulesets must have no bypass
  actors; only the creation ruleset exposes this one always-on team bypass.

The repository also needs enforced rulesets for `main` and `v*`. The `main`
ruleset must require a reviewed pull request, strict status checks named exactly
`Quality (lint, types, tests, builds)` and `Dependency Audit` from the GitHub
Actions app, code-owner review, stale-review dismissal or last-push approval,
resolved review threads, deletion protection, and non-fast-forward protection.
The stable-tag creation ruleset restricts `v*` creation to the configured
release-operator team and must contain no update/deletion rule. A separate
zero-bypass ruleset blocks every `v*` update and deletion and must contain no
creation rule, making tags immutable as soon as they exist. Enable repository
**immutable releases** as well. The
repository must be **public** before publication: npm provenance
requires the package's exact public source repository, and Electron's GitHub
updater must be able to read the release and assets without credentials. The CLI
package's `repository.url` must remain exactly
`https://github.com/eventools-io/postshow.git`. These controls are deliberately
external to source code. The workflow rereads the selected environment through
GitHub's API and fails closed unless its reviewer, self-review, and exact tag or
branch policy are present; it also refuses a tag whose commit is not the exact
current `origin/main` head. The same active ruleset contracts and the
remote tag-to-commit binding are rechecked before publication mutations; each npm
mutation also rechecks both tag rulesets, the immutable tag SHA, and the idle,
disabled historical workflow.

The tag-triggered release workflow fails closed if any input or external control
is absent, validates that the stable tag matches both package versions, runs the
complete repository suite and npm dry-run, builds without publishing, rereads
every platform signature/notarization/timestamp, hands artifacts through Actions
storage, and generates `SHA256SUMS.txt` over the exact set. Every third-party
Action is pinned to a reviewed full commit SHA, and CI continuously validates all
workflow YAML and embedded shell with pinned actionlint plus ShellCheck. Only the
protected final job may
publish the CLI (with npm provenance) or convert the staged GitHub draft into a
public, non-prerelease release. Publication and manual dry runs use separate
non-cancelling `queue: max` backlogs, so a third run cannot evict an earlier
pending release. Immediately before any public mutation, publication checks
the npm and GitHub latest stable versions and permits a non-increasing version
only as an idempotent recovery of matching bytes and an existing exact release;
an older recovery can never become GitHub latest or move npm's `latest` tag
backward. npm 11.18.0 is checksum-pinned; it cryptographically verifies the
Sigstore bundles and binds their signed package digest, repository, tag, commit,
workflow, hosted runner, `release` environment, and workflow run to the exact
handoff before accepting publication. Bootstrap alone uses a temporary dist-tag;
steady-state OIDC publishes directly to `latest` under the serialized, token-free
trusted publisher. Registry readback requires exact integrity, attestations,
public access, singleton ownership, monotonic `latest`, and no temporary tag.
GitHub asset names and server-computed SHA-256 digests are rebound to the local
files immediately before the draft becomes immutable. Release notes are freshly
generated from the protected tag and explicit prior stable release, then the safe
name, exact generated body, `draft=false`, and server-side `make_latest=legacy`
selection are applied atomically. Existing immutable recovery must already match
those trusted notes. After publication the workflow downloads and hash-
verifies every release asset without authentication, then anonymously reads the
current updater metadata and every artifact it references. Packaged macOS and
Windows updater configuration must point exactly to the public
`eventools-io/postshow` GitHub `latest` channel; Windows additionally pins the
full signing-certificate distinguished name.

Release handoff artifacts are retained for 90 days because signing timestamps,
notarization, and generated release metadata make a clean rebuild intentionally
non-byte-identical. If publication stops after npm or GitHub has changed, use
**Re-run failed jobs** on that original Actions run so the release job consumes
the same validated handoffs; never re-run all jobs or rebuild the platform jobs
for an in-progress version. The workflow accepts only exact-byte recovery and
will not overwrite an immutable release.

The exact packed CLI tarball is installed as both a global executable and a
consumer dependency under every supported Node line (20, 22, and 24). Each job
executes `postshow --help` and imports the declared `postshow/lib` exports from the
installed tarball; a source-tree build is not accepted as package evidence.
Separate installed-tarball jobs complete a random write/read/delete/read-back
roundtrip through `postshow/lib`'s `verifyNativeCredentialStore` against macOS
Keychain and Windows Credential Manager on native macOS ARM64, macOS Intel,
Windows x64, and Windows ARM64 hosts. The signed macOS app is copied from the
mounted DMG into a clean Applications-style directory before launch, and its
packaged self-test completes the same deletion-verified Keychain roundtrip
through the packaged Electron runtime on both native ARM64 and Intel runners.

Windows handoff acceptance runs each installer on native hardware: `windows-2025`
for x64 and GitHub's `windows-11-arm` ARM64 runner for ARM64. Each job verifies the
runner and PE architecture, Authenticode identity and timestamp, performs a silent
install, completes a deletion-verified Credential Manager roundtrip through the
packaged app, launches the tray process, repeats the exact installer as a supported
repair/reinstall, launches and roundtrips again, and silently uninstalls. An x64
runner is not accepted as evidence for the ARM64 artifact.

Those signing identities are the only packaging inputs intentionally external to
the repository. The signed `macos-15` job copies the mounted-DMG candidate into a
clean Applications-style directory, launches it, completes the packaged Keychain
roundtrip, replaces it with the exact candidate, repeats the checks, removes it,
and proves it is absent. The build also proves that the generated ICNS is byte-for-
byte identical in the staging app, mounted DMG, installed copies, and ZIP. The
native Intel job repeats signature, architecture, credential, launch, and removal
acceptance. The Windows jobs cover install, launch, Credential Manager roundtrip,
repair, and uninstall on both architectures, and prove that both applications
embed the exact generated multi-resolution ICO. On the first release there is no
prior public version, so no prior-to-current updater transition exists to test;
the workflow instead treats its post-publication anonymous metadata, artifact,
blockmap, checksum, and immutable-release readback as the complete update-channel
acceptance for that release.
