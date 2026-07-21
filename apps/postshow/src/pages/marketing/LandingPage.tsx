import { Link } from 'react-router-dom';
import { PillNav } from '@/components/marketing/PillNav';
import { WaitlistForm } from '@/components/marketing/WaitlistForm';
import { Demo } from '@/components/demo/Demo';
import { Logo } from '@/components/Logo';
import { LegalLinks } from '@/components/LegalLinks';
import { PAGE_META, usePageMeta } from '@/lib/seo';

const STACK = [
  'PostHog',
  'Stripe',
  'Postgres',
  'GitHub',
  'Linear',
  'Sentry',
  'Slack',
  'Resend',
  'Ollama',
];

const STEPS = [
  {
    number: '01',
    title: 'Connect your stack',
    body: 'PostHog, Stripe, Postgres, GitHub, Sentry. Start with least-scope access, then pick an engine: your API key, local Ollama, or a hosted model.',
  },
  {
    number: '02',
    title: 'It works the night shift',
    body: 'Sessions get watched and narrated. Anomalies spawn investigations that end in a why, not a chart. Findings become drafts overnight.',
  },
  {
    number: '03',
    title: 'You approve the moves',
    body: 'Open the inbox with coffee. Send the upgrade email, file the ticket, skip what is wrong. Every skip teaches it your taste.',
  },
];

const CAPABILITIES = [
  {
    number: '01',
    tag: 'Watch',
    title: 'High-signal sessions, narrated',
    body: 'Postshow prioritizes a bounded sample of useful sessions: where people flowed, hesitated, and what they clicked that did nothing.',
  },
  {
    number: '02',
    tag: 'Investigate',
    title: 'Root cause, not correlation',
    body: 'A metric moves and it pulls the thread: affected accounts, their sessions, the errors, the PR that shipped that morning.',
  },
  {
    number: '03',
    tag: 'Act',
    title: 'An inbox of drafted moves',
    body: 'Upgrade emails, bug tickets with repros, churn saves. Approve, edit, or skip; it learns from what you skip.',
  },
  {
    number: '04',
    tag: 'Remember',
    title: 'A dossier per account',
    body: 'Trajectory, tools adopted, friction hit, revenue. Ask who to talk to this week and get a real answer.',
  },
  {
    number: '05',
    tag: 'Schedule',
    title: 'It plans its own work',
    body: 'The agent proposes its own crons: nightly scans, weekly deep dives, standing investigations. You hold the veto.',
  },
  {
    number: '06',
    tag: 'Private',
    title: 'Local-first by design',
    body: 'Mark a supported source local-only to keep its credentials and raw records off Postshow cloud. Postgres is always device-only and runs one owner-configured, bounded read-only SELECT. Use Ollama to keep model processing on-device too.',
  },
];

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    blurb: 'Use your keys or your hardware with the current open-source Free plan.',
    points: [
      'Any provider in the catalog, or local models via Ollama',
      'Web, desktop, CLI, and MCP server',
      'All connectors, the full inbox, account dossiers',
      'Run it on demand or on your machine\u2019s schedule',
    ],
    highlighted: false,
  },
  {
    name: 'Solo',
    price: '$99/mo',
    blurb: 'Always-on. The agent works with your laptop closed, on our model bill.',
    points: [
      '3,000 sessions watched and 20 deep dives a month, included',
      'Hosted Anthropic and OpenAI models, chosen per task',
      'Cloud schedule: nightly sweeps, weekly deep dives, standing recon',
      'Over a budget it degrades gracefully; it never surprise-bills',
    ],
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$249/mo',
    blurb: 'Higher volumes and hourly cadence for the whole go-to-market team.',
    points: [
      '12,000 sessions watched and 60 deep dives a month, included',
      'Five seats for the go-to-market team',
      'Hourly sweeps during launches',
      'Everything in Solo',
    ],
    highlighted: false,
  },
  {
    name: 'Enterprise',
    price: 'Talk to us',
    blurb: 'For teams with rules about where data lives.',
    points: [
      'Custom quotas, seats, and usage billed on your terms',
      'Contract billing with metered usage reconciliation',
      'Security review and custom entitlement planning',
      'Direct line to the team',
    ],
    highlighted: false,
  },
];

const FAQ = [
  {
    q: 'How is this different from PostHog or Amplitude?',
    a: 'They tell you what happened, and they are great at it. Postshow starts where the dashboard ends: it watches the sessions behind the numbers, works out why they moved, and hands you a drafted action. PostHog is actually one of our launch connectors.',
  },
  {
    q: 'Where does my customer data go?',
    a: "Cloud connector and synced BYOK keys are write-only and stored server-side where no client role can read them. A local-only source keeps its credential and raw records on your device. Postgres is always device-only: it runs one owner-configured, bounded read-only SELECT, requires TLS for a remote database, and syncs only sanitized derived findings. A remote BYOK model still receives that run's evidence packet directly from your device; Ollama keeps model processing on-device. The full data-flow map is on the security page.",
  },
  {
    q: 'Which models does it use?',
    a: 'Your choice, per task: Anthropic, OpenAI, Kimi, GLM, DeepSeek, Grok, Mistral, any OpenAI-compatible endpoint, or local models through Ollama. You set the model and the effort for each kind of work, so a fast tier watches sessions all night and a frontier tier only wakes for deep dives.',
  },
  {
    q: 'What does it cost?',
    a: 'The current Free plan uses your own keys or local models and is open source. Hosted is $99/mo (Solo) or $249/mo (Team), with current self-service terms based on sessions watched and deep dives rather than tokens. Checkout and your applicable order show the authoritative plan terms.',
  },
  {
    q: 'Is it really open source?',
    a: 'Open core. The app, the CLI, the MCP server, the desktop agent, and the whole engine are MIT; the always-on cloud runtime and billing are the paid product. Details on the open source page.',
  },
  {
    q: 'When can I use it?',
    a: 'First beta in 2026. We are building it on our own SaaS first, and the waitlist gets one email when it opens.',
  },
];

const SURFACES = [
  {
    name: 'Web',
    detail: 'The synced workspace: inbox, dossiers, field notes, work plan.',
    code: 'postshow.io',
  },
  {
    name: 'Desktop',
    detail: 'A menu-bar agent. Runs local jobs while you work, catches up after sleep.',
    code: 'Postshow.app',
  },
  {
    name: 'CLI',
    detail: 'The wizard, the local runtime, and inbox review from any terminal.',
    code: 'npx postshow init',
  },
  {
    name: 'MCP',
    detail: 'Your coding agent reads dossiers and field notes with scoped workspace access.',
    code: 'postshow mcp',
  },
];

function Hero() {
  return (
    <section className="relative overflow-hidden pb-10 pt-20 md:pt-28">
      <div className="aurora" aria-hidden />
      <div className="relative mx-auto flex max-w-[880px] flex-col items-center px-5 text-center">
        <p className="reveal reveal-1 m-0 font-public-mono text-[12px] text-shell-fg-3">
          <span className="text-signal-deep">$</span> postshow run
        </p>
        <h1 className="reveal reveal-2 m-0 mt-6 max-w-[16ch] font-public-sans text-[clamp(40px,6vw,76px)] font-semibold leading-[1.04] tracking-[-0.035em] text-shell-fg [text-wrap:balance]">
          What happened last night,
          <em className="block font-normal italic text-shell-fg-3">
            <span className="highlight-swipe">and why.</span>
          </em>
        </h1>
        <p className="reveal reveal-3 m-0 mt-7 max-w-[58ch] font-public-sans text-[clamp(16px,1.6vw,19px)] leading-[1.55] text-shell-fg-2">
          Postshow is an AI teammate for B2B SaaS. It samples product behavior and connected
          signals, investigates why people convert, stall, or churn, and turns the answer into
          drafted emails, tickets, and plays. You approve. It learns.
        </p>
        <div className="reveal reveal-4 mt-9 flex flex-wrap justify-center gap-3">
          <a href="#waitlist" className="mk-btn-dark">
            Join the waitlist →
          </a>
          <a href="#demo" className="mk-btn-light">
            Try the live demo ↓
          </a>
        </div>
      </div>
    </section>
  );
}

function StackStrip() {
  return (
    <section className="mx-auto max-w-[1080px] px-5 pb-20 pt-8">
      <p className="mk-eyebrow m-0 text-center text-shell-fg-3">
        connects to the stack you already run
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {STACK.map((name) => (
          <span
            key={name}
            className="rounded-pill border border-shell-2 bg-shell-1 px-4 py-2 font-public-sans text-[13px] font-medium text-shell-fg-2"
          >
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section id="demo" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24">
      <div className="mx-auto max-w-[640px] text-center">
        <p className="mk-eyebrow m-0 text-signal-deep">the product</p>
        <h2 className="m-0 mt-3 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
          Don&rsquo;t read about it.
          <br />
          <em className="font-normal italic text-shell-fg-3">Click around in it.</em>
        </h2>
        <p className="m-0 mt-4 font-public-sans text-[15px] leading-[1.55] text-shell-fg-2">
          A real morning with Postshow, mock data, every button working. Yours would be drafted from
          your sessions, your accounts, and your code.
        </p>
      </div>
      <div className="mt-10">
        <Demo />
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section id="how" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24">
      <h2 className="m-0 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
        How it works
      </h2>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.number} className="rounded-lg border border-shell-3 bg-shell-1 p-6">
            <span className="font-public-mono text-[13px] font-medium text-signal-deep">
              {step.number}
            </span>
            <h3 className="m-0 mt-3 font-public-sans text-[19px] font-semibold leading-[1.25] tracking-[-0.01em] text-shell-fg">
              {step.title}
            </h3>
            <p className="m-0 mt-2 font-public-sans text-[14px] leading-[1.55] text-shell-fg-2">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CapabilitiesSlab() {
  return (
    <section className="mx-auto max-w-[1160px] px-4 pb-24">
      <div className="rounded-xl bg-night-0 px-6 py-14 md:px-14 md:py-20">
        <div className="mx-auto max-w-[560px] text-center">
          <p className="mk-eyebrow m-0 text-night-fg-3">everything it does</p>
          <h2 className="m-0 mt-3 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-night-fg">
            Six capabilities,
            <br />
            <em className="font-normal italic text-night-fg-3">one teammate.</em>
          </h2>
        </div>
        <div className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <div key={capability.number} className="border-t border-night-3 pt-5">
              <p className="m-0 flex items-baseline gap-3 font-public-mono text-[11px] font-medium uppercase tracking-[0.16em]">
                <span className="text-[20px] tracking-normal text-night-fg">
                  {capability.number}
                </span>
                <span className="text-signal">{capability.tag}</span>
              </p>
              <h3 className="m-0 mt-3 font-public-sans text-[18px] font-semibold leading-[1.25] tracking-[-0.01em] text-night-fg">
                {capability.title}
              </h3>
              <p className="m-0 mt-2 font-public-sans text-[14px] leading-[1.55] text-night-fg-2">
                {capability.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Surfaces() {
  return (
    <section className="mx-auto max-w-[1080px] px-5 pb-24">
      <div className="mx-auto max-w-[640px] text-center">
        <p className="mk-eyebrow m-0 text-signal-deep">four surfaces, one workspace</p>
        <h2 className="m-0 mt-3 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
          Wherever you work,
          <br />
          <em className="font-normal italic text-shell-fg-3">it&rsquo;s already there.</em>
        </h2>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SURFACES.map((surface) => (
          <div key={surface.name} className="rounded-lg border border-shell-3 bg-shell-1 p-5">
            <h3 className="m-0 font-public-sans text-[16px] font-semibold text-shell-fg">
              {surface.name}
            </h3>
            <p className="m-0 mt-2 min-h-[60px] font-public-sans text-[13px] leading-[1.5] text-shell-fg-2">
              {surface.detail}
            </p>
            <code className="mt-3 inline-block rounded-sm bg-shell-2 px-2 py-1 font-public-mono text-[12px] text-shell-fg">
              {surface.code}
            </code>
          </div>
        ))}
      </div>
      <p className="m-0 mt-6 text-center font-public-sans text-[14px] text-shell-fg-2">
        The CLI, MCP server, desktop agent, and engine are MIT-licensed.{' '}
        <Link
          to="/open-source"
          className="font-medium text-shell-fg underline decoration-signal decoration-2 underline-offset-4 hover:text-signal-deep"
        >
          Read the open source story
        </Link>
        .
      </p>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24">
      <h2 className="m-0 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
        Pricing
      </h2>
      <p className="m-0 mt-3 max-w-[60ch] font-public-sans text-[15px] leading-[1.55] text-shell-fg-2">
        Free is free because the model bill is already yours. The hosted tiers exist for the day you
        want it working while you sleep, priced in sessions watched and deep dives, never tokens.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={[
              'flex flex-col gap-4 rounded-lg border bg-shell-1 p-6',
              tier.highlighted
                ? 'border-signal-deep shadow-[0_12px_40px_rgba(154,103,0,0.12)]'
                : 'border-shell-3',
            ].join(' ')}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 font-public-sans text-[18px] font-semibold text-shell-fg">
                {tier.name}
              </h3>
              <span className="font-public-mono text-[13px] font-medium text-signal-deep">
                {tier.price}
              </span>
            </div>
            <p className="m-0 font-public-sans text-[14px] leading-[1.5] text-shell-fg-2">
              {tier.blurb}
            </p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {tier.points.map((point) => (
                <li
                  key={point}
                  className="flex gap-2 font-public-sans text-[13px] leading-[1.5] text-shell-fg-2"
                >
                  <span
                    className="mt-[7px] inline-block h-[5px] w-[5px] shrink-0 rounded-pill bg-signal-deep"
                    aria-hidden
                  />
                  {point}
                </li>
              ))}
            </ul>
            <a
              href="#waitlist"
              className={`${tier.highlighted ? 'mk-btn-dark' : 'mk-btn-light'} mt-auto w-full`}
            >
              Join the waitlist
            </a>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-lg border border-shell-3 bg-shell-1 p-6">
        <p className="mk-eyebrow m-0 text-signal-deep">a note on the numbers</p>
        <p className="m-0 mt-3 max-w-[72ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
          The Free plan puts model usage on your provider account or local hardware. Hosted quotas
          are based on sessions watched and deep dives under the current checkout terms. Over an
          included budget, the agent thins its sampling and defers deep dives to the next billing
          period instead of surprise-billing. The MIT-licensed clients and engine remain available
          if a managed plan stops fitting your needs.
        </p>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-[820px] scroll-mt-24 px-5 pb-24">
      <h2 className="m-0 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
        Questions we keep getting
      </h2>
      <div className="mt-6 flex flex-col">
        {FAQ.map((item) => (
          <details key={item.q} className="group border-b border-shell-3 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-public-sans text-[16px] font-medium text-shell-fg [&::-webkit-details-marker]:hidden">
              {item.q}
              <span
                className="font-public-mono text-[16px] text-shell-fg-3 transition-transform duration-[120ms] group-open:rotate-45"
                aria-hidden
              >
                +
              </span>
            </summary>
            <p className="m-0 mt-3 max-w-[70ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function WaitlistSlab() {
  return (
    <section id="waitlist" className="mx-auto max-w-[1160px] scroll-mt-24 px-4 pb-24">
      <div className="flex flex-col items-center rounded-xl bg-night-0 px-6 py-16 text-center md:py-20">
        <h2 className="m-0 max-w-[18ch] font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-night-fg [text-wrap:balance]">
          Be in the room for the <em className="font-normal italic text-night-fg-3">first run.</em>
        </h2>
        <p className="m-0 mt-4 max-w-[54ch] font-public-sans text-[15px] leading-[1.55] text-night-fg-2">
          We&rsquo;re building Postshow on our own product before anyone else&rsquo;s. One email
          when the beta opens. That&rsquo;s the whole list.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <WaitlistForm />
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-shell-3">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-[8px] font-public-sans text-[16px] font-semibold tracking-[-0.02em] text-shell-fg">
            <Logo size={22} />
            Postshow
          </span>
          <span className="font-public-mono text-[11px] uppercase tracking-[0.12em] text-shell-fg-3">
            an eventools product
          </span>
          <p className="m-0 max-w-[36ch] font-public-sans text-[13px] leading-[1.55] text-shell-fg-3">
            Built by the team behind eventools.io, on our own product first.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <nav aria-label="Product" className="flex flex-col gap-2">
            <span className="mk-eyebrow text-shell-fg-3">Product</span>
            <a
              href="#demo"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Live demo
            </a>
            <a
              href="#pricing"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Pricing
            </a>
            <Link
              to="/security"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Security
            </Link>
            <Link
              to="/open-source"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Open source
            </Link>
            <Link
              to="/signin"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Sign in
            </Link>
          </nav>
          <nav aria-label="Company" className="flex flex-col gap-2">
            <span className="mk-eyebrow text-shell-fg-3">Company</span>
            <a
              href="https://eventools.io"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              eventools.io
            </a>
            <a
              href="https://eventools.io/blog"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Blog
            </a>
          </nav>
          <div className="flex flex-col gap-2">
            <span className="mk-eyebrow text-shell-fg-3">Legal &amp; support</span>
            <LegalLinks layout="column" />
          </div>
        </div>
      </div>
      <p className="m-0 mx-auto max-w-[1080px] border-t border-shell-3 px-5 py-6 font-public-sans text-[12px] text-shell-fg-3">
        © 2026 Eventools LLC
      </p>
    </footer>
  );
}

export function LandingPage() {
  usePageMeta(PAGE_META.landing!);
  return (
    <div className="min-h-screen bg-shell-0">
      <PillNav />
      <main>
        <Hero />
        <StackStrip />
        <DemoSection />
        <Steps />
        <CapabilitiesSlab />
        <Surfaces />
        <Pricing />
        <FaqSection />
        <WaitlistSlab />
      </main>
      <SiteFooter />
    </div>
  );
}
