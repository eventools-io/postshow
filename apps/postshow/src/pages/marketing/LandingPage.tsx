import { Link } from 'react-router-dom';
import { PillNav } from '@/components/marketing/PillNav';
import { WaitlistForm } from '@/components/marketing/WaitlistForm';
import { Demo } from '@/components/demo/Demo';
import { Logo } from '@/components/Logo';
import { LegalLinks } from '@/components/LegalLinks';
import { PAGE_META, usePageMeta } from '@/lib/seo';

const REPOSITORY_URL = 'https://github.com/eventools-io/postshow';
const STACK = ['PostHog', 'Stripe', 'GitHub', 'Sentry'];

const LOOP = [
  {
    number: '01',
    title: 'Find the customer problem',
    body: 'Group corroborating product behavior into one incident instead of another disconnected alert.',
  },
  {
    number: '02',
    title: 'Ground the impact',
    body: 'Connect exact evidence to affected accounts and current revenue exposure without guessing at identity.',
  },
  {
    number: '03',
    title: 'Review the response',
    body: 'Prepare the product work and customer follow-up together. A person approves each consequential action.',
  },
  {
    number: '04',
    title: 'Return with a result',
    body: 'Run the recovery check saved before the intervention and report recovery, regression, or an inconclusive result.',
  },
];

const EVIDENCE_REQUIREMENTS = [
  ['Behavior', 'Exact PostHog events and replay references'],
  ['Account', 'Deterministic Stripe identity links'],
  ['Technical failure', 'An incident-specific Sentry issue'],
  ['Code context', 'A validated GitHub repository object'],
  ['Recovery check', 'A saved metric, a baseline, a direction, and a window'],
] as const;

const FAQ = [
  {
    q: 'How is this different from product analytics or error monitoring?',
    a: 'Postshow does not replace either one. It turns their evidence into a customer incident, connects that incident to affected accounts, prepares the response, and keeps the record open until there is a measured outcome.',
  },
  {
    q: 'What works today?',
    a: 'The closed-beta foundation persists replay evidence, deterministic account links, current revenue exposure, linked Sentry issues, proposed actions, a recovery plan, and a policy-owned act, gather-more, or abstain decision in one incident. Exact GitHub references, automated fix preparation, and measured outcomes are the next delivery slices.',
  },
  {
    q: 'Can Postshow send messages or merge code by itself?',
    a: 'No. Customer messages stay drafts. Code changes stay draft pull requests. Postshow cannot merge, bypass branch protection, force-push, or turn an evidence decision into execution.',
  },
  {
    q: 'Where does my customer data go?',
    a: 'Cloud connector and synced BYOK keys are write-only and stored server-side where no client role can read them. A local-only source keeps its credential and raw records on your device. Postgres is always device-only. Only schema-validated derived findings sync, though those findings can still contain customer context. The security page documents the complete data flow.',
  },
  {
    q: 'Is Postshow open source?',
    a: 'The incident and evidence contracts, connector engine, web and desktop clients, CLI, MCP server, and local runtime are MIT licensed. The managed scheduler, multi-tenant control plane, billing, and hosted execution live separately. The managed product pins the same public evidence contract.',
  },
  {
    q: 'Who is the closed beta for?',
    a: 'We are starting with compact B2B SaaS teams that use PostHog, Stripe, and GitHub, with Sentry as an optional technical source. We want teams willing to bring one real customer problem and judge Postshow on whether it helps resolve it.',
  },
];

function IncidentReceipt() {
  return (
    <aside
      className="reveal reveal-4 relative min-w-0 overflow-hidden rounded-xl border border-night-3 bg-night-0 p-5 text-night-fg shadow-[0_28px_80px_rgba(20,23,15,0.2)] md:p-6"
      aria-label="Illustrative Postshow customer incident"
    >
      <div
        className="absolute -right-12 -top-12 h-32 w-32 rounded-[50%] bg-signal/10 blur-3xl"
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-3 border-b border-night-3 pb-4">
        <div className="min-w-0">
          <p className="mk-eyebrow m-0 text-signal">illustrative incident</p>
          <p className="m-0 mt-2 font-public-mono text-[11px] text-night-fg-3">PS-ONBOARDING-07</p>
        </div>
        <span className="rounded-pill border border-warn/40 bg-warn/10 px-3 py-1 font-public-mono text-[10px] uppercase tracking-[0.12em] text-warn">
          gather more
        </span>
      </div>

      <h2 className="relative m-0 mt-5 max-w-[22ch] font-public-sans text-[24px] font-semibold leading-[1.18] tracking-[-0.025em]">
        Seven trials stalled at the same onboarding step.
      </h2>
      <p className="relative m-0 mt-3 font-public-sans text-[13px] leading-[1.55] text-night-fg-2">
        Behavior and affected accounts are grounded. Technical and code evidence still need exact
        links before product work is ready for review.
      </p>

      <dl className="relative m-0 mt-6 border-t border-night-3">
        {[
          ['Behavior', '7 replay references', 'grounded'],
          ['Account impact', 'Affected trials linked', 'grounded'],
          ['Technical failure', 'Sentry issue not linked', 'needed'],
          ['Code context', 'GitHub object not linked', 'needed'],
          ['Recovery check', 'Activation completion, 7 days', 'defined'],
        ].map(([label, value, state]) => (
          <div key={label} className="grid grid-cols-[1fr_auto] gap-3 border-b border-night-3 py-3">
            <div>
              <dt className="font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
                {label}
              </dt>
              <dd className="m-0 mt-1 font-public-sans text-[12px] text-night-fg-2">{value}</dd>
            </div>
            <dd
              className={`m-0 self-center font-public-mono text-[10px] uppercase tracking-[0.1em] ${
                state === 'needed' ? 'text-warn' : 'text-signal'
              }`}
            >
              {state}
            </dd>
          </div>
        ))}
      </dl>

      <p className="relative m-0 mt-4 flex items-center gap-2 font-public-sans text-[11px] text-night-fg-3">
        <span className="h-[6px] w-[6px] rounded-[50%] bg-warn" aria-hidden />
        No action taken. Human review remains required.
      </p>
    </aside>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pb-14 pt-20 md:pt-28">
      <div className="aurora" aria-hidden />
      <div className="relative mx-auto grid max-w-[1120px] items-center gap-12 px-5 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
        <div>
          <p className="reveal reveal-1 m-0 font-public-mono text-[12px] text-shell-fg-3">
            <span className="text-signal-deep">$</span> postshow incident review
          </p>
          <h1 className="reveal reveal-2 m-0 mt-6 max-w-[12ch] font-public-sans text-[clamp(44px,6.6vw,78px)] font-semibold leading-[1.01] tracking-[-0.045em] text-shell-fg [text-wrap:balance]">
            Turn customer friction into{' '}
            <em className="font-normal italic text-shell-fg-3">
              <span className="highlight-swipe">verified fixes.</span>
            </em>
          </h1>
          <p className="reveal reveal-3 m-0 mt-7 max-w-[55ch] font-public-sans text-[clamp(16px,1.6vw,19px)] leading-[1.6] text-shell-fg-2">
            Postshow finds the customer problems worth fixing, shows the exact evidence and affected
            accounts, prepares the product and customer response, then comes back with a measured
            result. Nothing consequential happens without you.
          </p>
          <div className="reveal reveal-4 mt-9 flex flex-wrap gap-3">
            <a href="#waitlist" className="mk-btn-dark w-full sm:w-auto">
              Bring us a real incident →
            </a>
            <a href="#demo" className="mk-btn-light w-full sm:w-auto">
              Review the product ↓
            </a>
            <a
              href={REPOSITORY_URL}
              className="mk-btn-light w-full sm:w-auto"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </div>
        </div>
        <IncidentReceipt />
      </div>
    </section>
  );
}

function StackStrip() {
  return (
    <section className="mx-auto max-w-[1080px] px-5 pb-20 pt-4">
      <div className="flex flex-col items-center justify-between gap-4 border-y border-shell-3 py-5 sm:flex-row">
        <p className="mk-eyebrow m-0 text-shell-fg-3">initial customer stack</p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {STACK.map((name) => (
            <span key={name} className="font-public-mono text-[12px] font-medium text-shell-fg-2">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section id="demo" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24">
      <div className="grid gap-6 md:grid-cols-[0.72fr_1.28fr] md:items-end">
        <div>
          <p className="mk-eyebrow m-0 text-signal-deep">the product object</p>
          <h2 className="m-0 mt-3 font-public-sans text-[clamp(32px,4.5vw,54px)] font-semibold leading-[1.04] tracking-[-0.035em] text-shell-fg">
            One incident.
            <br />
            <em className="font-normal italic text-shell-fg-3">The whole customer story.</em>
          </h2>
        </div>
        <p className="m-0 max-w-[62ch] font-public-sans text-[15px] leading-[1.65] text-shell-fg-2 md:justify-self-end">
          The authenticated beta already keeps replay evidence, deterministic account impact, linked
          Sentry issues, a policy-owned evidence decision, proposed actions, and a recovery plan
          together. This walkthrough uses synthetic data to show the complete target loop. Exact
          GitHub code references, intervention execution, and measured outcomes are still being
          built.
        </p>
      </div>
      <div className="mt-10">
        <Demo />
      </div>
    </section>
  );
}

function RecoveryLoop() {
  return (
    <section id="loop" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24">
      <div className="max-w-[700px]">
        <p className="mk-eyebrow m-0 text-signal-deep">the recovery loop</p>
        <h2 className="m-0 mt-3 font-public-sans text-[clamp(32px,4.5vw,54px)] font-semibold leading-[1.04] tracking-[-0.035em] text-shell-fg">
          The work is not done when the finding appears.
        </h2>
      </div>
      <ol className="m-0 mt-10 grid list-none gap-x-7 gap-y-8 border-t border-shell-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {LOOP.map((step) => (
          <li key={step.number} className="pt-5">
            <span className="font-public-mono text-[12px] font-medium text-signal-deep">
              {step.number}
            </span>
            <h3 className="m-0 mt-4 font-public-sans text-[18px] font-semibold leading-[1.25] tracking-[-0.015em] text-shell-fg">
              {step.title}
            </h3>
            <p className="m-0 mt-2 font-public-sans text-[14px] leading-[1.6] text-shell-fg-2">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function IncidentContract() {
  return (
    <section id="contract" className="mx-auto max-w-[1160px] scroll-mt-24 px-4 pb-24">
      <div className="grid overflow-hidden rounded-xl bg-night-0 text-night-fg lg:grid-cols-[1.05fr_0.95fr]">
        <div className="px-6 py-12 md:px-12 md:py-16">
          <p className="mk-eyebrow m-0 text-signal">the incident contract</p>
          <h2 className="m-0 mt-3 max-w-[16ch] font-public-sans text-[clamp(32px,4.5vw,54px)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Every claim has a place to point.
          </h2>
          <p className="m-0 mt-5 max-w-[55ch] font-public-sans text-[15px] leading-[1.65] text-night-fg-2">
            The model can explain a hypothesis. It cannot invent a source, certify its own evidence,
            or decide that uncertainty has disappeared.
          </p>
          <dl className="m-0 mt-8 border-t border-night-3">
            {EVIDENCE_REQUIREMENTS.map(([term, description], index) => (
              <div
                key={term}
                className="grid gap-2 border-b border-night-3 py-4 sm:grid-cols-[32px_145px_1fr] sm:gap-4"
              >
                <span className="font-public-mono text-[10px] text-signal">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <dt className="font-public-sans text-[13px] font-medium text-night-fg">{term}</dt>
                <dd className="m-0 font-public-sans text-[13px] leading-[1.5] text-night-fg-2">
                  {description}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="border-t border-night-3 bg-night-1 px-6 py-12 md:px-12 md:py-16 lg:border-l lg:border-t-0">
          <p className="mk-eyebrow m-0 text-night-fg-3">policy result</p>
          <div className="mt-7 space-y-7">
            <div>
              <p className="m-0 font-public-mono text-[12px] font-medium uppercase tracking-[0.12em] text-signal">
                act
              </p>
              <p className="m-0 mt-2 font-public-sans text-[14px] leading-[1.6] text-night-fg-2">
                Enough grounded evidence exists to put a proposed intervention in front of a person.
                No action executes.
              </p>
            </div>
            <div>
              <p className="m-0 font-public-mono text-[12px] font-medium uppercase tracking-[0.12em] text-warn">
                gather more
              </p>
              <p className="m-0 mt-2 font-public-sans text-[14px] leading-[1.6] text-night-fg-2">
                A named source is incomplete, and one bounded collection could change the decision.
              </p>
            </div>
            <div>
              <p className="m-0 font-public-mono text-[12px] font-medium uppercase tracking-[0.12em] text-night-fg">
                abstain
              </p>
              <p className="m-0 mt-2 font-public-sans text-[14px] leading-[1.6] text-night-fg-2">
                Collection is complete enough to judge, but the evidence is insufficient,
                contradictory, or outside Postshow&rsquo;s safe scope.
              </p>
            </div>
          </div>
          <p className="m-0 mt-10 border-t border-night-3 pt-5 font-public-mono text-[10px] uppercase tracking-[0.12em] text-night-fg-3">
            versioned inputs · stable reason · reproducible decision
          </p>
        </div>
      </div>
    </section>
  );
}

function OutcomeSection() {
  return (
    <section className="mx-auto max-w-[1080px] px-5 pb-24">
      <div className="grid gap-10 border-y border-shell-3 py-12 md:grid-cols-[1.05fr_0.95fr] md:items-center md:py-16">
        <div>
          <p className="mk-eyebrow m-0 text-signal-deep">the standard</p>
          <blockquote className="m-0 mt-4 max-w-[18ch] font-public-sans text-[clamp(30px,4vw,48px)] font-semibold leading-[1.08] tracking-[-0.03em] text-shell-fg">
            A merged pull request is not a resolved customer problem.
          </blockquote>
        </div>
        <div>
          <p className="m-0 font-public-sans text-[15px] leading-[1.65] text-shell-fg-2">
            Postshow saves the recovery measure before an intervention. Today that is a metric, a
            baseline, a direction, and a window, written onto the incident the moment it forms.
          </p>
          <ul
            className="m-0 mt-6 flex list-none flex-wrap gap-2 p-0"
            aria-label="Planned outcome states"
          >
            {['recovered', 'improving', 'unchanged', 'regressed', 'inconclusive'].map((outcome) => (
              <li
                key={outcome}
                className="rounded-pill border border-shell-3 bg-shell-1 px-3 py-2 font-public-mono text-[10px] uppercase tracking-[0.1em] text-shell-fg-2"
              >
                {outcome}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-5 font-public-sans text-[13px] leading-[1.55] text-shell-fg-3">
            Postshow does not report an outcome yet. These five are what the recovery check will
            return, and the negative and inconclusive ones will stay on the incident instead of
            being rewritten as a win.
          </p>
        </div>
      </div>
    </section>
  );
}

function OpenSourceCallout() {
  return (
    <section className="mx-auto max-w-[1080px] px-5 pb-24">
      <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-start">
        <div>
          <p className="mk-eyebrow m-0 text-signal-deep">open source</p>
          <h2 className="m-0 mt-3 font-public-sans text-[clamp(30px,4vw,48px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
            The trust contract is public.
          </h2>
        </div>
        <div>
          <p className="m-0 max-w-[62ch] font-public-sans text-[15px] leading-[1.65] text-shell-fg-2">
            The incident types, evidence policy, connector engine, CLI, MCP server, desktop agent,
            and reference web client are MIT licensed. Read how a decision was made, run the local
            evidence path, or help build the next provider contract.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/open-source" className="mk-btn-dark">
              Start contributing →
            </Link>
            <a href={REPOSITORY_URL} className="mk-btn-light" target="_blank" rel="noreferrer">
              View GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-[820px] scroll-mt-24 px-5 pb-24">
      <p className="mk-eyebrow m-0 text-signal-deep">questions</p>
      <h2 className="m-0 mt-3 font-public-sans text-[clamp(30px,4vw,48px)] font-semibold leading-[1.06] tracking-[-0.03em] text-shell-fg">
        What Postshow does, and what it does not.
      </h2>
      <div className="mt-7 flex flex-col">
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
            <p className="m-0 mt-3 max-w-[70ch] font-public-sans text-[14px] leading-[1.65] text-shell-fg-2">
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
      <div className="grid gap-8 rounded-xl bg-night-0 px-6 py-14 text-night-fg md:grid-cols-[1fr_0.85fr] md:items-center md:px-12 md:py-16">
        <div>
          <p className="mk-eyebrow m-0 text-signal">closed beta</p>
          <h2 className="m-0 mt-3 max-w-[16ch] font-public-sans text-[clamp(32px,4.5vw,54px)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Bring one customer problem we can help close.
          </h2>
          <p className="m-0 mt-5 max-w-[58ch] font-public-sans text-[15px] leading-[1.65] text-night-fg-2">
            We are proving the complete loop on eventools.io, then admitting a small group of B2B
            SaaS teams that use PostHog, Stripe, and GitHub. We will judge the beta on resolved
            customer problems, not generated output.
          </p>
        </div>
        <div className="md:justify-self-end">
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
          <p className="m-0 max-w-[38ch] font-public-sans text-[13px] leading-[1.55] text-shell-fg-3">
            Find the customer problem. Show the receipts. Help fix it. Prove recovery.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <nav aria-label="Product" className="flex flex-col gap-2">
            <span className="mk-eyebrow text-shell-fg-3">Product</span>
            <a
              href="#demo"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Incident demo
            </a>
            <a
              href="#contract"
              className="font-public-sans text-[14px] text-shell-fg-2 hover:text-shell-fg"
            >
              Evidence contract
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
              href={REPOSITORY_URL}
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
        <RecoveryLoop />
        <IncidentContract />
        <OutcomeSection />
        <OpenSourceCallout />
        <FaqSection />
        <WaitlistSlab />
      </main>
      <SiteFooter />
    </div>
  );
}
