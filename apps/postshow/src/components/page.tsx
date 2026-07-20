import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="mb-6">
      <h1 className="m-0 font-public-sans text-[24px] font-semibold tracking-[-0.02em] text-night-fg">
        {title}
      </h1>
      {sub && (
        <p className="m-0 mt-1 font-public-sans text-[13px] leading-[1.5] text-night-fg-2">{sub}</p>
      )}
    </header>
  );
}

export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; to: string };
}) {
  return (
    <div className="ps-card flex flex-col items-start gap-3 p-8">
      <span className="inline-block h-[8px] w-[8px] bg-signal" aria-hidden />
      <h2 className="m-0 font-public-sans text-[16px] font-semibold text-night-fg">{title}</h2>
      <p className="m-0 max-w-[56ch] font-public-sans text-[14px] leading-[1.55] text-night-fg-2">
        {body}
      </p>
      {cta && (
        <Link to={cta.to} className="ps-btn-primary mt-2">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export function LoadingRow() {
  return (
    <p className="m-0 font-public-mono text-[12px] uppercase tracking-[0.14em] text-night-fg-3">
      loading…
    </p>
  );
}

export function ErrorRow({ message }: { message: string }) {
  return (
    <p className="m-0 font-public-sans text-[13px] text-bad" role="alert">
      {message}
    </p>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="m-0 mb-3 font-public-mono text-[11px] font-medium uppercase tracking-[0.14em] text-night-fg-3">
        {title}
      </h2>
      {children}
    </section>
  );
}
