import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { LegalLinks } from '@/components/LegalLinks';
import { PAGE_META, usePageMeta } from '@/lib/seo';

const REPOSITORY_URL = 'https://github.com/eventools-io/postshow';

const COMPONENTS = [
  {
    path: 'packages/postshow-core',
    name: 'Evidence and model engine',
    detail:
      'Connector adapters, source-coverage contracts, task prompts, sanitization, scheduling, retries, and cost rules.',
  },
  {
    path: 'packages/postshow-cli',
    name: 'CLI and MCP server',
    detail: 'Workspace setup, local execution, inbox review, exports, and scoped agent access.',
  },
  {
    path: 'apps/postshow',
    name: 'Web product',
    detail: 'The public site, authenticated incident review, and synthetic full-loop walkthrough.',
  },
  {
    path: 'apps/postshow-desktop',
    name: 'Desktop runtime',
    detail: 'The local scheduler, secure credential access, diagnostics, and release packaging.',
  },
];

export function OpenSourcePage() {
  usePageMeta(PAGE_META.openSource!);
  return (
    <div className="min-h-screen bg-shell-0 text-shell-fg">
      <header className="border-b border-shell-3">
        <div className="mx-auto flex h-16 w-full max-w-[920px] items-center justify-between px-5">
          <Link
            to="/"
            className="flex items-center gap-[10px] font-public-sans text-[17px] font-semibold tracking-[-0.02em] text-shell-fg"
          >
            <Logo size={22} />
            Postshow
          </Link>
          <div className="flex items-center gap-4">
            <a
              href={REPOSITORY_URL}
              className="font-public-sans text-[13px] font-medium text-shell-fg hover:text-signal-deep"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
            <Link
              to="/"
              className="font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg"
            >
              ← Back
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[920px] px-5 pb-24 pt-14">
        <p className="mk-eyebrow m-0 text-signal-deep">open source</p>
        <h1 className="m-0 mt-3 max-w-[18ch] font-public-sans text-[clamp(36px,6vw,64px)] font-semibold leading-[1.03] tracking-[-0.035em]">
          Read the engine.
          <em className="block font-normal italic text-shell-fg-3">Help improve the loop.</em>
        </h1>
        <p className="m-0 mt-6 max-w-[66ch] font-public-sans text-[16px] leading-[1.65] text-shell-fg-2">
          Postshow connects product evidence to affected customers, proposed interventions, and a
          verification plan. Its shared contract also exposes the source coverage behind each run;
          the managed incident ledger turns that into an explicit act, gather-more, or abstain
          decision. This repository contains the evidence and identity engine, incident-review web
          client, local runtime, CLI, MCP server, desktop agent, and a synthetic walkthrough of the
          full recovery loop. Automated fix preparation and measured outcomes are still being built.
          All of these components are MIT licensed.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={REPOSITORY_URL} className="mk-btn-dark" target="_blank" rel="noreferrer">
            View the repository ↗
          </a>
          <a
            href={`${REPOSITORY_URL}/blob/main/CONTRIBUTING.md`}
            className="mk-btn-light"
            target="_blank"
            rel="noreferrer"
          >
            Contribution guide
          </a>
        </div>

        <section className="mt-16 border-t border-shell-3 pt-8">
          <div className="grid gap-4 md:grid-cols-[220px_1fr] md:gap-10">
            <div>
              <p className="mk-eyebrow m-0 text-shell-fg-3">repository map</p>
              <h2 className="m-0 mt-2 font-public-sans text-[24px] font-semibold tracking-[-0.02em]">
                Four places to work
              </h2>
            </div>
            <div className="flex flex-col border-t border-shell-3">
              {COMPONENTS.map((component) => (
                <a
                  key={component.path}
                  href={`${REPOSITORY_URL}/tree/main/${component.path}`}
                  className="grid gap-2 border-b border-shell-3 py-5 text-shell-fg no-underline hover:bg-shell-1 sm:grid-cols-[190px_1fr] sm:px-3"
                  target="_blank"
                  rel="noreferrer"
                >
                  <code className="font-public-mono text-[11px] text-signal-deep">
                    {component.path}
                  </code>
                  <span>
                    <strong className="block font-public-sans text-[15px] font-semibold">
                      {component.name}
                    </strong>
                    <span className="mt-1 block font-public-sans text-[13px] leading-[1.5] text-shell-fg-2">
                      {component.detail}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-8 rounded-xl bg-night-0 px-6 py-8 text-night-fg md:grid-cols-[1fr_1.25fr] md:px-9 md:py-10">
          <div>
            <p className="mk-eyebrow m-0 text-signal">local development</p>
            <h2 className="m-0 mt-3 font-public-sans text-[26px] font-semibold tracking-[-0.02em]">
              One install, scoped commands
            </h2>
            <p className="m-0 mt-3 font-public-sans text-[14px] leading-[1.6] text-night-fg-2">
              Use Node 24 and pnpm 10. Start with the package you want to change, then run the full
              repository checks before opening a pull request.
            </p>
          </div>
          <pre className="m-0 overflow-x-auto rounded-lg border border-night-3 bg-night-1 p-5 font-public-mono text-[12px] leading-[1.9] text-night-fg">
            <code>{`pnpm install
pnpm --filter @eventools/postshow dev
pnpm --filter @eventools/postshow test

# before a pull request
pnpm test
pnpm type-check
pnpm lint
pnpm build
pnpm format:check
git diff --check`}</code>
          </pre>
        </section>

        <section className="mt-16 grid gap-8 border-t border-shell-3 pt-8 md:grid-cols-2">
          <div>
            <p className="mk-eyebrow m-0 text-signal-deep">first contribution</p>
            <h2 className="m-0 mt-2 font-public-sans text-[24px] font-semibold tracking-[-0.02em]">
              Start with a bounded problem
            </h2>
            <p className="m-0 mt-3 font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
              Look for a scoped issue, reproduce it, and comment before taking on a large change.
              Connector work must use synthetic fixtures or fully scrubbed recordings from a
              maintainer-owned test account; never capture production or customer responses. Source
              access stays read-only and product actions remain human approved.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={`${REPOSITORY_URL}/issues/new?template=feature_request.yml`}
                className="mk-btn-dark"
                target="_blank"
                rel="noreferrer"
              >
                Propose a contribution ↗
              </a>
              <a
                href={`${REPOSITORY_URL}/issues/new/choose`}
                className="mk-btn-light"
                target="_blank"
                rel="noreferrer"
              >
                Report a problem
              </a>
            </div>
          </div>
          <div>
            <p className="mk-eyebrow m-0 text-shell-fg-3">open-core boundary</p>
            <h2 className="m-0 mt-2 font-public-sans text-[24px] font-semibold tracking-[-0.02em]">
              The managed runtime is separate
            </h2>
            <p className="m-0 mt-3 font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
              This repository contains the clients and local runtime. Postshow&rsquo;s supported
              always-on control plane, scheduler, billing, and hosted model gateway are maintained
              separately. The MIT components are useful building blocks, but this repository does
              not promise a one-command clone of the managed service.
            </p>
            <p className="m-0 mt-3 font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
              Read the{' '}
              <Link to="/security" className="font-medium text-shell-fg underline">
                security page
              </Link>{' '}
              for credential, local-only, model, and data-flow boundaries.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-shell-3">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-public-sans text-[12px] text-shell-fg-3">
            © 2026 Eventools LLC
          </span>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}
