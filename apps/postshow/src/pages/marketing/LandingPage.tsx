import { Link } from 'react-router-dom';
import { PillNav } from '@/components/marketing/PillNav';
import { WaitlistForm } from '@/components/marketing/WaitlistForm';
import { Demo } from '@/components/demo/Demo';
import { Logo } from '@/components/Logo';
import { LegalLinks } from '@/components/LegalLinks';
import { PAGE_META, usePageMeta } from '@/lib/seo';

const STACK = ['PostHog', 'Stripe', 'GitHub', 'Sentry'];

const STEPS = [
  {
    number: '01',
    title: 'Find the customer problem',
    body: 'Postshow reads recent product behavior and groups corroborating sessions into one incident with replay evidence.',
  },
  {
    number: '02',
    title: 'Connect impact to cause',
    body: 'Stripe identifies the affected accounts and revenue. GitHub and Sentry add the code and error context needed to explain the cause.',
  },
  {
    number: '03',
    title: 'Review, act, and verify',
    body: 'Review the product fix and customer response together. After the intervention, Postshow checks whether the behavior recovered.',
  },
];

const CAPABILITIES = [
  {
    number: '01',
    tag: 'Evidence',
    title: 'The receipts behind the incident',
    body: 'Replay sessions, errors, events, and metrics stay attached to the claim so a human can verify it in one click.',
  },
  {
    number: '02',
    tag: 'Impact',
    title: 'The accounts and revenue affected',
    body: 'Identity resolution connects product behavior to customer accounts and shows where the business impact is concentrated.',
  },
  {
    number: '03',
    tag: 'Repair',
    title: 'One review for both sides',
    body: 'Review the code fix beside the account follow-up. Nothing merges or sends without a human decision.',
  },
  {
    number: '04',
    tag: 'Outcome',
    title: 'Proof after the work ships',
    body: 'Postshow reruns the evidence check and reports whether the customer behavior improved, stayed flat, or needs another intervention.',
  },
];

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    blurb: 'Planned beta access for provisioned workspaces using your keys or hardware.',
    points: [
      'Any provider in the catalog, or local models via Ollama',
      'Web, desktop, CLI, and MCP server',
      'Supported connectors, incident evidence, and human-reviewed drafts',
      'Run it on demand or on your machine\u2019s schedule',
    ],
    highlighted: false,
  },
  {
    name: 'Solo',
    price: '$99/mo',
    blurb: 'Planned always-on access, including hosted model usage.',
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
    blurb: 'Planned higher volumes and shared review across customer and product teams.',
    points: [
      '12,000 sessions watched and 60 deep dives a month, included',
      'Five seats across product, engineering, and customer teams',
      'Hourly sweeps during launches',
      'Everything in Solo',
    ],
    highlighted: false,
  },
  {
    name: 'Enterprise',
    price: 'Talk to us',
    blurb: 'Planned custom terms for teams with rules about where data lives.',
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
    a: 'Postshow does not replace product analytics. The closed-beta goal is to turn corroborating behavior into a customer incident that connects replay evidence, affected accounts, revenue, suspected product cause, proposed actions, and the result after the work ships. PostHog is the initial behavior source.',
  },
  {
    q: 'Where does my customer data go?',
    a: "Cloud connector and synced BYOK keys are write-only and stored server-side where no client role can read them. A local-only source keeps its credential and raw records on your device. Postgres is always device-only: it runs one owner-configured, bounded read-only SELECT and requires TLS for a remote database. Only schema-validated derived findings sync, but they can still contain customer context. A remote BYOK model receives that run's evidence packet directly from your device; Ollama keeps model processing on-device. The full data-flow map is on the security page.",
  },
  {
    q: 'Which models does it use?',
    a: 'Your choice, per task: Anthropic, OpenAI, Kimi, GLM, DeepSeek, Grok, Mistral, any OpenAI-compatible endpoint, or local models through Ollama. You set the model and the effort for each kind of work, so a fast tier watches sessions all night and a frontier tier only wakes for deep dives.',
  },
  {
    q: 'What does it cost?',
    a: 'Planned beta pricing is $0 with your own keys or local models, $99/mo for Solo, and $249/mo for Team, using sessions watched and deep dives rather than tokens. There is no public checkout while access remains gated; final order terms will control.',
  },
  {
    q: 'Is it really open source?',
    a: 'Open core. The app, the CLI, the MCP server, the desktop agent, and the whole engine are MIT; the always-on cloud runtime and billing are the paid product. Details on the open source page.',
  },
  {
    q: 'When can I use it?',
    a: 'The closed beta starts in 2026. We review every application and admit a small group as capacity opens. We only email about the application and access; there is no drip sequence.',
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
          From customer friction
          <em className="block font-normal italic text-shell-fg-3">
            <span className="highlight-swipe">to verified recovery.</span>
          </em>
        </h1>
        <p className="reveal reveal-3 m-0 mt-7 max-w-[58ch] font-public-sans text-[clamp(16px,1.6vw,19px)] leading-[1.55] text-shell-fg-2">
          We&rsquo;re building Postshow to connect real sessions to affected accounts and revenue,
          prepare the product fix and customer response, then check whether the intervention worked.
          Every claim should come with evidence. Nothing ships without you.
        </p>
        <div className="reveal reveal-4 mt-9 flex flex-wrap justify-center gap-3">
          <a href="#waitlist" className="mk-btn-dark">
            Apply for the closed beta →
          </a>
          <a href="#demo" className="mk-btn-light">
            Review a customer incident ↓
          </a>
          <a
            href="https://github.com/eventools-io/postshow"
            className="mk-btn-light"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </section>
  );
}

function StackStrip() {
  return (
    <section className="mx-auto max-w-[1080px] px-5 pb-20 pt-8">
      <p className="mk-eyebrow m-0 text-center text-shell-fg-3">initial evidence stack</p>
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
          This interactive mock shows the target review flow with synthetic data. The current
          contract supports evidence gathering and draft review; the unified incident and outcome
          record is the closed-beta direction.
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
        The loop we&rsquo;re building
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
          <p className="mk-eyebrow m-0 text-night-fg-3">the target incident contract</p>
          <h2 className="m-0 mt-3 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-night-fg">
            One customer incident,
            <br />
            <em className="font-normal italic text-night-fg-3">from evidence to outcome.</em>
          </h2>
        </div>
        <div className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-2">
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

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24">
      <h2 className="m-0 font-public-sans text-[clamp(30px,4.4vw,52px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
        Planned beta pricing
      </h2>
      <p className="m-0 mt-3 max-w-[60ch] font-public-sans text-[15px] leading-[1.55] text-shell-fg-2">
        These are the pricing targets for the closed beta, not public offers. Use your own model
        keys or local hardware for free; planned hosted tiers keep the loop running with your laptop
        closed.
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
              Apply for the beta
            </a>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-lg border border-shell-3 bg-shell-1 p-6">
        <p className="mk-eyebrow m-0 text-signal-deep">a note on the numbers</p>
        <p className="m-0 mt-3 max-w-[72ch] font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
          The planned Free tier puts model usage on your provider account or local hardware. Hosted
          quotas are designed around sessions watched and deep dives. Over an included budget, the
          agent should thin its sampling and defer deep dives to the next billing period instead of
          surprise-billing. Final beta invitations and order terms will control availability and
          limits.
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
          Bring one customer problem to the{' '}
          <em className="font-normal italic text-night-fg-3">closed beta.</em>
        </h2>
        <p className="m-0 mt-4 max-w-[54ch] font-public-sans text-[15px] leading-[1.55] text-night-fg-2">
          We&rsquo;re proving the complete incident-to-recovery loop on eventools.io first, then
          admitting a small group of B2B SaaS teams that use PostHog, Stripe, and GitHub.
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
            <a
              href="https://github.com/eventools-io/postshow"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
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
        <Pricing />
        <FaqSection />
        <WaitlistSlab />
      </main>
      <SiteFooter />
    </div>
  );
}
