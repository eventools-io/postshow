import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LegalLinks } from '@/components/LegalLinks';
import { Logo } from '@/components/Logo';

export interface LegalSectionLink {
  id: string;
  label: string;
}

export const LEGAL_TEXT_LINK_CLASS =
  'rounded-sm font-medium text-signal-deep underline decoration-signal-deep/40 underline-offset-4 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep';

export function LegalPage({
  eyebrow,
  title,
  summary,
  effectiveDate,
  sections,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: ReactNode;
  effectiveDate: string;
  sections: readonly LegalSectionLink[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-shell-0 text-shell-fg">
      <header className="border-b border-shell-3 bg-shell-0/95">
        <div className="mx-auto flex min-h-16 w-full max-w-[980px] flex-wrap items-center justify-between gap-4 px-5 py-3">
          <Link
            to="/"
            className="flex items-center gap-[10px] rounded-sm font-public-sans text-[17px] font-semibold tracking-[-0.02em] text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
          >
            <Logo size={22} />
            Postshow
          </Link>
          <nav
            aria-label="Postshow legal policies"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 font-public-sans text-[13px]"
          >
            <Link to="/terms" className="text-shell-fg-2 hover:text-shell-fg">
              Terms
            </Link>
            <Link to="/privacy" className="text-shell-fg-2 hover:text-shell-fg">
              Privacy
            </Link>
            <Link to="/cookies" className="text-shell-fg-2 hover:text-shell-fg">
              Cookies
            </Link>
            <Link to="/security" className="text-shell-fg-2 hover:text-shell-fg">
              Security
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[980px] px-5 pb-24 pt-14">
        <div className="max-w-[760px]">
          <p className="mk-eyebrow m-0 text-signal-deep">{eyebrow}</p>
          <h1 className="m-0 mt-3 font-public-sans text-[clamp(34px,5vw,56px)] font-semibold leading-[1.05] tracking-[-0.03em]">
            {title}
          </h1>
          <div className="mt-5 max-w-[68ch] font-public-sans text-[16px] leading-[1.65] text-shell-fg-2">
            {summary}
          </div>
          <p className="m-0 mt-5 font-public-mono text-[11px] uppercase tracking-[0.14em] text-shell-fg-3">
            Effective <time dateTime="2026-07-21">{effectiveDate}</time>
          </p>
        </div>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-shell-3 bg-shell-1 p-5 lg:sticky lg:top-5">
            <p className="mk-eyebrow m-0 text-shell-fg-3">On this page</p>
            <nav aria-label={`${title} sections`} className="mt-4">
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-sm font-public-sans text-[12px] leading-[1.45] text-shell-fg-2 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-deep"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <article className="min-w-0">{children}</article>
        </div>
      </main>

      <footer className="border-t border-shell-3">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-public-sans text-[12px] text-shell-fg-3">
            © 2026 Eventools LLC
          </span>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-8 border-t border-shell-3 py-8 first:border-t-0 first:pt-0"
    >
      <h2 className="m-0 font-public-sans text-[22px] font-semibold leading-[1.25] tracking-[-0.02em]">
        {title}
      </h2>
      <div className="mt-4 space-y-4 font-public-sans text-[14px] leading-[1.7] text-shell-fg-2">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex flex-col gap-2 pl-5 marker:text-signal-deep">{children}</ul>;
}

export function LegalCallout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="rounded-lg border border-signal-deep/35 bg-signal/10 p-5 text-shell-fg-2">
      <h3 className="m-0 font-public-sans text-[14px] font-semibold text-shell-fg">{title}</h3>
      <div className="mt-2 space-y-3">{children}</div>
    </aside>
  );
}

export function LegalDefinitionGrid({
  items,
}: {
  items: readonly { term: string; detail: ReactNode }[];
}) {
  return (
    <dl className="m-0 grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="rounded-lg border border-shell-3 bg-shell-1 p-4">
          <dt className="font-public-sans text-[13px] font-semibold text-shell-fg">{item.term}</dt>
          <dd className="m-0 mt-1 font-public-sans text-[13px] leading-[1.6] text-shell-fg-2">
            {item.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}
