import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';

const LINKS = [
  { label: 'Product', href: '#demo' },
  { label: 'How it works', href: '#how' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

/** Floating pill navigation over the light shell. */
export function PillNav() {
  return (
    <header className="sticky top-4 z-30 px-4">
      <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3">
        <Link
          to="/"
          className="flex items-center gap-[10px] rounded-pill border border-shell-3 bg-shell-1 px-4 py-2 font-public-sans text-[16px] font-semibold tracking-[-0.02em] text-shell-fg shadow-[0_2px_16px_rgba(20,23,15,0.06)] backdrop-blur"
        >
          <Logo size={22} />
          Postshow
          <span className="ml-1 hidden font-public-mono text-[10px] uppercase tracking-[0.14em] text-shell-fg-3 sm:inline">
            by eventools
          </span>
        </Link>

        <nav
          aria-label="Main"
          className="hidden items-center gap-1 rounded-pill border border-shell-3 bg-shell-1 px-2 py-1 shadow-[0_2px_16px_rgba(20,23,15,0.06)] backdrop-blur md:flex"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-pill px-4 py-2 font-public-sans text-[13px] text-shell-fg-2 hover:bg-shell-2 hover:text-shell-fg"
            >
              {link.label}
            </a>
          ))}
          <Link
            to="/security"
            className="rounded-pill px-4 py-2 font-public-sans text-[13px] text-shell-fg-2 hover:bg-shell-2 hover:text-shell-fg"
          >
            Security
          </Link>
        </nav>

        <div className="flex items-center gap-1 rounded-pill border border-shell-3 bg-shell-1 p-1 shadow-[0_2px_16px_rgba(20,23,15,0.06)] backdrop-blur">
          <Link
            to="/signin"
            className="rounded-pill px-3 py-[6px] font-public-sans text-[13px] font-medium text-shell-fg-2 hover:bg-shell-2 hover:text-shell-fg"
          >
            Sign in
          </Link>
          <a href="#waitlist" className="mk-btn-dark !h-8 !px-4 text-[13px]">
            Join the waitlist
          </a>
        </div>
      </div>
    </header>
  );
}
