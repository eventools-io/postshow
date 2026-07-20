import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { PAGE_META, usePageMeta } from '@/lib/seo';

const FLOWS = [
  {
    title: 'Stays in your accounts',
    highlighted: true,
    items: [
      'Your PostHog, Stripe, Postgres, GitHub, Sentry data at rest',
      'Local-only sources: raw rows are read at run time and discarded; only findings are stored',
      'Your model API key is write-only: stored server-side, never returned to any client',
    ],
  },
  {
    title: 'Stored by Postshow',
    highlighted: false,
    items: [
      'Workspace, connections (config, not raw source data), engine settings',
      'The agent outputs: inbox drafts, field notes, account dossiers, run logs',
      'Connector keys, encrypted at rest, readable only by the agent runtime',
    ],
  },
  {
    title: 'Sent to a model provider',
    highlighted: false,
    items: [
      'Compressed evidence packets (event sequences, aggregates), per run',
      'BYOK tier: your key, your provider, your data-retention agreement',
      'Hosted tier: zero-retention API options, never used for model training',
    ],
  },
];

const SUBPROCESSORS = [
  { name: 'Supabase', purpose: 'database, auth, and function hosting' },
  { name: 'Netlify', purpose: 'static hosting for this site and the app shell' },
  { name: 'Stripe', purpose: 'billing for the hosted plan' },
  { name: 'PostHog', purpose: 'product analytics for Postshow itself (not your customer data)' },
  {
    name: 'Anthropic or OpenAI',
    purpose: 'hosted-tier model calls only; BYOK calls go to your own provider account',
  },
  { name: 'Resend', purpose: 'transactional email (waitlist, account emails)' },
];

export function SecurityPage() {
  usePageMeta(PAGE_META.security!);
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

      <main className="mx-auto w-full max-w-[860px] px-5 py-14">
        <h1 className="m-0 font-public-sans text-[clamp(32px,4.5vw,48px)] font-semibold leading-[1.08] tracking-[-0.025em]">
          Security
        </h1>
        <p className="m-0 mt-3 max-w-[64ch] font-public-sans text-[15px] leading-[1.6] text-shell-fg-2">
          Postshow reads your product analytics, billing, and database. That deserves precision, not
          marketing. This page states exactly what we store, what moves where, and what we can and
          cannot claim yet.
        </p>

        <h2 className="mk-eyebrow m-0 mt-12 text-shell-fg-3">Where data lives</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {FLOWS.map((flow) => (
            <div
              key={flow.title}
              className={[
                'rounded-lg border bg-shell-1 p-5',
                flow.highlighted ? 'border-signal-deep' : 'border-shell-3',
              ].join(' ')}
            >
              <h3 className="m-0 font-public-sans text-[15px] font-semibold text-shell-fg">
                {flow.title}
              </h3>
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {flow.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 font-public-sans text-[13px] leading-[1.5] text-shell-fg-2"
                  >
                    <span
                      className="mt-[7px] inline-block h-[5px] w-[5px] shrink-0 rounded-pill bg-signal-deep"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <h2 className="mk-eyebrow m-0 mt-12 text-shell-fg-3">Key handling</h2>
        <p className="m-0 mt-3 max-w-[68ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
          Connector and model keys are write-only. They are submitted once over TLS, stored in
          tables no client role can read (verified by row-level security with no read policies, plus
          revoked table grants), and touched only by the agent runtime at execution time. The app
          can replace a key; nothing can display one. We ask for read-only, least-scope keys
          everywhere a provider supports them, and the connection flow documents the exact scopes
          each source needs.
        </p>

        <h2 className="mk-eyebrow m-0 mt-12 text-shell-fg-3">Retention and training</h2>
        <p className="m-0 mt-3 max-w-[68ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
          Your data is never used to train models, ours or anyone&rsquo;s. On the BYOK tier, model
          calls go to your own provider account under your own data-processing agreement. On the
          hosted tier, calls use provider zero-retention options: prompts and outputs live for the
          request, then they are gone. Run logs keep the agent&rsquo;s findings and evidence
          summaries, not raw source rows, and you can delete a workspace and everything in it at any
          time.
        </p>

        <h2 className="mk-eyebrow m-0 mt-12 text-shell-fg-3">Sub-processors</h2>
        <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
          {SUBPROCESSORS.map((sub) => (
            <li
              key={sub.name}
              className="flex flex-wrap items-baseline gap-x-3 border-b border-shell-3 pb-2 font-public-sans text-[14px]"
            >
              <span className="font-medium text-shell-fg">{sub.name}</span>
              <span className="text-shell-fg-2">{sub.purpose}</span>
            </li>
          ))}
        </ul>

        <h2 className="mk-eyebrow m-0 mt-12 text-shell-fg-3">Compliance status</h2>
        <p className="m-0 mt-3 max-w-[68ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
          Stated precisely: Postshow is not SOC 2 certified today. We follow the underlying controls
          (least-privilege access, encrypted transport and storage, audit logging via run records)
          and a formal report is planned alongside the hosted tier. A DPA is available on request
          before then. If a claim on this page ever stops being true, the page changes the same day.
        </p>

        <p className="m-0 mt-12 font-public-sans text-[14px] text-shell-fg-2">
          Security questions or disclosure:{' '}
          <a href="mailto:security@eventools.io" className="text-signal-deep hover:text-shell-fg">
            security@eventools.io
          </a>
        </p>
      </main>

      <footer className="border-t border-shell-3">
        <div className="mx-auto flex w-full max-w-[860px] items-center justify-between px-5 py-8 font-public-sans text-[13px] text-shell-fg-3">
          <span>an eventools product</span>
          <span>© 2026 eventools</span>
        </div>
      </footer>
    </div>
  );
}
