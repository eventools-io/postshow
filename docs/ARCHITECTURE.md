# Postshow architecture

This document is the shortest path from a product problem to the right package and test suite.

## Target product flow

The Phase 1 incident spine is now persisted: source-grounded replay evidence, deterministic account identities, customer impact, suspected cause, proposed interventions, and a verification contract share one tenant-safe dossier. Automated code-fix preparation and measured post-intervention outcomes remain later phases.

```text
PostHog / Stripe / GitHub / Sentry
                 │
                 ▼
    connector adapters + scoped gathering
                 │
                 ▼
      evidence packet + model task contract
                 │
                 ▼
    schema-validated findings and drafts
                 │
                 ▼
        human review in authenticated web
                 │
                 ▼
      approved interventions + outcome check
```

`packages/postshow-core` owns provider-neutral evidence gathering and model behavior. The CLI, desktop app, web app, and managed cloud runtime consume its current contract rather than implementing their own prompts or derived-state rules.

The public dependency flow is:

```text
postshow-core ──▶ CLI library ──▶ desktop runtime
       │
       ├────────▶ web app
       │
       └────────▶ generated Deno mirror in the managed runtime
```

The desktop app delegates secure configuration, credential-store access, and local execution to the CLI library. Consequential inbox review continues in the authenticated web app.

## Current contract

The current `ModelOutput` contract produces a summary, source-grounded field notes and inbox items, account updates, an optional proposed job, an optional proposed rule, and scratchpad updates. A deterministic identity context—not the model—maps exact Stripe identities and unambiguous PostHog sessions to accounts. The hosted commit materializes a parent customer incident with replay evidence, current revenue exposure, a suspected cause, proposed interventions, and a verification contract. Inbox actions can draft email, GitHub issue, or Linear issue work for human review, or propose adopting a rule. Code-fix/pull-request actions and measured post-intervention outcomes are not implemented yet.

The v-next work will introduce those pieces deliberately. Until then, public previews must identify the unified incident and verification flow as the closed-beta target rather than current product behavior.

## Package responsibilities

### `packages/postshow-core`

Owns connector adapters, model calls, retry and timeout behavior, task classes, prompts, structural output validation and bounds, scheduling rules, plan limits, and model-price metadata. Validated output can still contain customer context; validation is not anonymization.

Keep this package independent of browser, Electron, Supabase, and UI concerns. Changes to model output must update sanitization and every consuming surface together.

The core must also remain free of Node built-ins and runtime workspace dependencies. The managed Deno bundler consumes a generated mirror maintained in the private cloud repository; a normal-looking Node import can break that deployment even when local TypeScript passes.

Run:

```sh
pnpm --filter @eventools/postshow-core test
pnpm --filter @eventools/postshow-core type-check
```

### `packages/postshow-cli`

Owns configuration, secure credential access, local execution, workspace API calls, exports, inbox commands, and the MCP server. It consumes `postshow-core` for actual evidence and model work.

Run:

```sh
pnpm --filter postshow test
pnpm --filter postshow type-check
```

### `apps/postshow`

Owns the public site, authentication, incident-review workspace UI, synthetic full-loop walkthrough, billing presentation, and browser calls to the hosted API. It must treat API responses as untrusted boundaries and keep private artifacts out of persistent browser storage.

Run:

```sh
pnpm --filter @eventools/postshow test
pnpm --filter @eventools/postshow type-check
pnpm --filter @eventools/postshow build
```

### `apps/postshow-desktop`

Owns background scheduling, sleep and wake recovery, desktop orchestration, diagnostics, updates, and signed packaging. Secure configuration, OS credential integration, and local execution come from the CLI library. The renderer does not receive raw connector credentials.

Run:

```sh
pnpm --filter @eventools/postshow-desktop test
pnpm --filter @eventools/postshow-desktop type-check
pnpm --filter @eventools/postshow-desktop build
```

## Runtime boundaries

| Surface       | Runs locally                                                     | Requires the hosted workspace                                                                  |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CLI           | Credential access, connector gathering, BYOK or Ollama inference | Token, run claims, workspace context, heartbeats, and committing derived output                |
| Desktop       | Scheduling, wake recovery, CLI orchestration, OS integration     | The same workspace API used by the CLI                                                         |
| Web           | Browser rendering and authenticated review                       | Authentication, workspace state, persistence, and approved action handoff                      |
| Managed cloud | Not included in this repository                                  | Control plane, managed schedules, billing, hosted model gateway, and the generated core mirror |

There is no standalone local control plane in this repository. Unit tests and UI development do not require hosted credentials, but a real run does require a provisioned workspace.

## Cross-package changes

Use this checklist before editing a shared contract:

| Change               | Also inspect                                                                    |
| -------------------- | ------------------------------------------------------------------------------- |
| Connector output     | Evidence-packet rendering, redaction, fixtures, timeout behavior                |
| Model output         | Prompt schema, validator, CLI and browser types, every public consuming surface |
| Action type          | Prompt allowlist, validator, public API type, approval UI                       |
| Task class or model  | Catalog, plan eligibility, cost accounting, public margin tests                 |
| Schedule behavior    | Core schedule rules and the CLI/desktop scheduler                               |
| Public product claim | Current implementation, marketing truth tests, security boundary                |

For changes that affect a shared hosted contract, contributors should describe the compatibility or migration concern in the pull request. Maintainers are responsible for the private persistence update, generated Deno mirror, cloud compatibility tests, and pinned-core rollout after merge.

## Connector contract

A publicly supported connector must have:

1. A real gather path that contributes behavior, identity, revenue, code, or error evidence.
2. Least-scope and read-only access by default.
3. A bounded request timeout and a useful partial-failure result.
4. Synthetic fixtures, or fully scrubbed recordings from a maintainer-owned test account, for success, malformed data, timeout, rate limit, and redaction. Never use production or customer captures.
5. No credential or private raw-record leakage into logs or persisted model output.

A configured provider without that contract is "coming soon," not implemented.

## Security and product invariants

- Credentials stay in the designated credential store and never enter a prompt.
- Tenant identifiers are explicit at every hosted boundary.
- Local-only means raw source data and credentials do not transit Postshow cloud.
- Connector failure degrades one evidence section rather than silently fabricating it.
- Consequential writes are typed operations with explicit human approval.
- Unknown model prices or malformed usage records fail accounting visibly.

Read [SECURITY.md](../SECURITY.md) before changing authentication, credentials, tenancy, exports, model routing, or outbound actions.

## Pull-request scope

Prefer one product contract per pull request. Include the exact commands used to verify the change and call out security, privacy, migration, compatibility, licensing, and release impact. The repository template lists the required checks.
