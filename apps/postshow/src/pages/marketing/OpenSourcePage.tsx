import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { LegalLinks } from '@/components/LegalLinks';
import { PAGE_META, usePageMeta } from '@/lib/seo';

const OPEN = [
  {
    name: 'The web app',
    detail: 'Marketing site and the full workspace UI: inbox, dossiers, field notes, work plan.',
  },
  {
    name: 'The CLI',
    detail:
      'npm package `postshow`. The setup wizard, the local agent runtime, inbox review, and the doctor.',
  },
  {
    name: 'The MCP server',
    detail:
      'postshow mcp over stdio. Your coding agent reads dossiers and field notes with scoped workspace access.',
  },
  {
    name: 'The desktop agent',
    detail: 'The Electron menu-bar shell: background scheduler, catch-up on wake, local runtime.',
  },
  {
    name: 'The engine',
    detail:
      'The whole brain: model catalog for seven providers plus Ollama, per-task model and effort resolution, the agent prompts, connector adapters, sanitizers, scheduling.',
  },
];

const PAID = [
  'The always-on cloud runtime that runs your schedule with your laptop closed',
  'Hosted models on our bill, priced in sessions watched and deep dives',
  'Billing, quotas, and the managed gateway',
];

export function OpenSourcePage() {
  usePageMeta(PAGE_META.openSource!);
  return (
    <div className="min-h-screen bg-shell-0 text-shell-fg">
      <header className="border-b border-shell-3">
        <div className="mx-auto flex h-16 w-full max-w-[860px] items-center justify-between px-5">
          <Link
            to="/"
            className="flex items-center gap-[10px] font-public-sans text-[17px] font-semibold tracking-[-0.02em] text-shell-fg"
          >
            <Logo size={22} />
            Postshow
          </Link>
          <Link to="/" className="font-public-sans text-[13px] text-shell-fg-2 hover:text-shell-fg">
            ← Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[860px] px-5 pb-24 pt-14">
        <p className="mk-eyebrow m-0 text-signal-deep">open source</p>
        <h1 className="m-0 mt-3 max-w-[20ch] font-public-sans text-[clamp(32px,5vw,56px)] font-semibold leading-[1.05] tracking-[-0.03em]">
          MIT where you run it.
          <em className="block font-normal italic text-shell-fg-3">Paid where we run it.</em>
        </h1>
        <p className="m-0 mt-6 max-w-[64ch] font-public-sans text-[16px] leading-[1.6] text-shell-fg-2">
          Postshow is open core: the product is open source, and the always-on cloud is the
          business. An agent that reads your sessions, your revenue, and your errors should be code
          you can read back.
        </p>

        <section className="mt-12">
          <h2 className="m-0 font-public-sans text-[22px] font-semibold tracking-[-0.02em]">
            MIT licensed
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            {OPEN.map((item) => (
              <div key={item.name} className="rounded-lg border border-shell-3 bg-shell-1 p-5">
                <h3 className="m-0 font-public-sans text-[15px] font-semibold">{item.name}</h3>
                <p className="m-0 mt-1 font-public-sans text-[14px] leading-[1.55] text-shell-fg-2">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="m-0 font-public-sans text-[22px] font-semibold tracking-[-0.02em]">
            The paid part
          </h2>
          <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
            {PAID.map((item) => (
              <li
                key={item}
                className="flex gap-2 font-public-sans text-[14px] leading-[1.55] text-shell-fg-2"
              >
                <span
                  className="mt-[8px] inline-block h-[5px] w-[5px] shrink-0 rounded-pill bg-signal-deep"
                  aria-hidden
                />
                {item}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-4 max-w-[64ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
            The current Free plan puts model usage on your provider account or local hardware. The
            hosted tiers add the managed runtime and hosted model usage under the plan terms shown
            at checkout. The MIT-licensed clients and engine remain available if a managed plan
            stops fitting your needs.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="m-0 font-public-sans text-[22px] font-semibold tracking-[-0.02em]">
            Try the open parts now
          </h2>
          <div className="mt-4 rounded-lg bg-night-0 p-5">
            <pre className="m-0 overflow-x-auto font-public-mono text-[13px] leading-[1.8] text-night-fg">
              <code>{`npx postshow init      # detect supported tools and guide setup
postshow run           # execute due jobs with your keys or Ollama
postshow inbox         # list and review what the agent drafted
postshow mcp           # expose the workspace to your coding agent`}</code>
            </pre>
          </div>
          <p className="m-0 mt-4 max-w-[64ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
            Everything above develops in the open in one repository. Credentials never enter a model
            prompt. A local-only connection keeps its key and raw source records off Postshow cloud;
            a remote model still receives the evidence packet needed for that run, while Ollama
            keeps model processing on-device. Postgres is always device-only: the runtime stores its
            connection string and one owner-configured read-only SELECT in the OS credential store,
            requires TLS for remote databases, bounds the rows it reads, and syncs only sanitized
            derived findings. Those rows are part of the evidence packet and reach a remote BYOK
            model if you select one. Supported outbound actions require an authenticated browser
            review before they execute.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="m-0 font-public-sans text-[22px] font-semibold tracking-[-0.02em]">
            Self-hosting, honestly
          </h2>
          <p className="m-0 mt-4 max-w-[64ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
            The repository gives you inspectable client surfaces and the local runtime, but it does
            not ship a supported one-command replacement for Postshow&rsquo;s hosted control plane.
            Building and operating your own service from the MIT components is possible engineering
            work, not a turnkey product claim: you own deployment, security, scheduling, billing,
            upgrades, and compatibility. Eventools does not support or warrant self-managed
            deployments unless a separate written agreement says otherwise.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/#waitlist" className="mk-btn-dark">
              Join the waitlist →
            </a>
            <Link to="/security" className="mk-btn-light">
              Read the security page
            </Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-shell-3">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-public-sans text-[12px] text-shell-fg-3">
            © 2026 Eventools LLC
          </span>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}
