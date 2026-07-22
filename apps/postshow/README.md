# Postshow web

The `@eventools/postshow` package contains two browser surfaces:

- the public marketing, open-source, security, sign-in, and legal pages;
- the current authenticated workspace for Inbox actions, accounts, field notes, connections, work plans, and settings, plus the synthetic preview of the target customer-incident flow.

Start with the repository-level [architecture guide](../../docs/ARCHITECTURE.md) and [contribution guide](../../CONTRIBUTING.md).

## Develop

```sh
pnpm --filter @eventools/postshow dev
pnpm --filter @eventools/postshow test
pnpm --filter @eventools/postshow type-check
pnpm --filter @eventools/postshow build
```

The development server runs at `http://localhost:5173` by default.

## Code map

| Path                             | Responsibility                                                    |
| -------------------------------- | ----------------------------------------------------------------- |
| `src/pages/marketing`            | Public product, open-source, security, and account-access pages   |
| `src/pages`                      | Authenticated workspace routes                                    |
| `src/components/demo`            | Interactive public preview using synthetic data                   |
| `src/components/settings`        | Workspace, billing, engine, member, export, and deletion controls |
| `src/state/WorkspaceContext.tsx` | Authenticated workspace state and permissions                     |
| `src/lib/api.ts`                 | Typed browser boundary for hosted API operations                  |
| `src/lib/types.ts`               | Persisted client-facing data contracts                            |
| `src/lib/seo.ts`                 | Route metadata mirrored by static prerendering                    |

## Public claims

Marketing copy must match current behavior and security boundaries. Update `MarketingTruth.test.tsx` when a public claim changes, but do not weaken an assertion merely to make new copy pass.

The closed-beta form is named `beta-signup`. Netlify detects its static skeleton in `public/__forms.html`; the React form submits to the matching endpoint without navigating away.

## Browser boundaries

- Treat API and function responses as untrusted input.
- Do not persist connector credentials, raw private source records, signed artifact URLs, or private exports in browser storage.
- Keep hosted actions behind the authenticated API and explicit workspace permissions.
- Customer communication and code writes remain human approved.

The workspace-export client streams the private NDJSON artifact from an exact-project signed Storage URL. It persists only replay-safe request references and never buffers the export or stores its signed URL in the browser.

Read the root [SECURITY.md](../../SECURITY.md) before changing authentication, invitations, billing, exports, deletion, model settings, or connector handling.
