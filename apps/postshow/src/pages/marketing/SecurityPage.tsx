import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { LegalLinks } from '@/components/LegalLinks';
import { PAGE_META, usePageMeta } from '@/lib/seo';

const FLOWS = [
  {
    title: 'Stays in your accounts',
    highlighted: true,
    items: [
      'Your PostHog, Stripe, GitHub, and Sentry source data at rest',
      'Local-only sources: credentials and raw source records stay off Postshow cloud',
      'Postgres: device-only connection string and one owner-configured, bounded read-only SELECT; remote databases require TLS',
      'On-device Ollama runs keep the evidence packet and model processing on the device',
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
      'Purpose-built evidence packets (event sequences, account context, aggregates), per run',
      'BYOK tier: your key, your provider, your data-retention agreement',
      'Hosted tier: handling follows the contracted terms and account settings for the selected provider',
      'Local-only plus a remote model still sends the evidence packet directly to that provider',
    ],
  },
];

const SUBPROCESSORS = [
  { name: 'Supabase', purpose: 'database, auth, and function hosting' },
  { name: 'Netlify', purpose: 'static hosting, app-shell delivery, and beta-signup forms' },
  { name: 'Stripe', purpose: 'billing for the hosted plan' },
  { name: 'Metronome', purpose: 'enterprise usage metering and billing reconciliation' },
  {
    name: 'PostHog',
    purpose:
      'optional, consent-based product analytics, interaction capture, performance, errors, heatmaps, and masked session replay',
  },
  {
    name: 'Selected model provider',
    purpose:
      'evidence packets and generated output; hosted routes use Anthropic or OpenAI, while BYOK uses the provider you configure',
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
          Postshow reads your product analytics, billing, code, and error systems. That deserves
          precision, not marketing. This page states what we store, what moves where, and what we
          can and cannot claim yet.
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
          Cloud connector and BYOK model keys are write-only. They are submitted once over TLS,
          stored in Supabase Vault, and represented in application tables only by service-only
          references that no browser role can read. The hosted runtime resolves a reference only
          while executing work. Local-only credentials are stored in the operating system credential
          store and are not synced to Postshow. The app can replace a key; it cannot display one. We
          ask for read-only, least-scope keys everywhere a provider supports them. Postgres is a
          stricter device-only path: its connection string and configured query remain in the OS
          credential store, the runtime accepts one bounded read-only SELECT, and non-loopback
          databases must explicitly require TLS. Query rows can enter the evidence packet sent to
          the selected local or BYOK model on that device; only sanitized derived findings sync into
          the Postshow workspace.
        </p>

        <h2 className="mk-eyebrow m-0 mt-12 text-shell-fg-3">Retention and training</h2>
        <p className="m-0 mt-3 max-w-[68ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
          Model-provider handling follows the API account settings and contractual terms that apply
          to each run. BYOK calls use your provider account and agreement; hosted calls use the
          configured Eventools provider account. We describe a route as &ldquo;not used for
          training&rdquo; or &ldquo;zero retention&rdquo; only when those applicable terms and
          account settings support it. Postshow run records keep findings and evidence summaries
          rather than raw source rows. Workspace deletion removes tenant content, connector and
          engine secrets, API tokens, and active provider resources. Redacted financial and deletion
          proof, containing no credentials, provider routing IDs, or raw provider receipts, is
          retained for seven years where accounting and fraud controls require it; the requester can
          retrieve the completion receipt for 30 days.
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
          Stated precisely: Postshow is not SOC 2 certified today. The technical controls and
          retention boundaries above are the current security evidence; they are not a substitute
          for an independent certification. If your use requires a security review, a data
          processing agreement, or handling terms for regulated data, contact us before enabling the
          hosted tier at{' '}
          <a href="mailto:security@eventools.io" className="text-signal-deep hover:text-shell-fg">
            security@eventools.io
          </a>
          .
        </p>

        <p className="m-0 mt-12 font-public-sans text-[14px] text-shell-fg-2">
          Security questions or disclosure:{' '}
          <a href="mailto:security@eventools.io" className="text-signal-deep hover:text-shell-fg">
            security@eventools.io
          </a>
        </p>
      </main>

      <footer className="border-t border-shell-3">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-5 py-8 font-public-sans text-[13px] text-shell-fg-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span>an eventools product</span>
            <span>© 2026 Eventools LLC</span>
          </div>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}
