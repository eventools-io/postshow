import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { usePageMeta } from '@/lib/seo';

const NOT_FOUND_META = {
  title: 'Page not found · Postshow',
  description: 'The requested Postshow page could not be found.',
  path: '/404',
  noindex: true,
} as const;

export function NotFoundPage() {
  usePageMeta(NOT_FOUND_META);
  return (
    <main className="flex min-h-screen items-center justify-center bg-shell-0 px-5 text-shell-fg">
      <div className="w-full max-w-[480px] rounded-lg border border-shell-3 bg-shell-1 p-7">
        <span className="flex items-center gap-[10px] font-public-sans text-[18px] font-semibold">
          <Logo size={22} />
          Postshow
        </span>
        <p className="mk-eyebrow m-0 mt-6 text-shell-fg-3">404</p>
        <h1 className="m-0 mt-2 font-public-sans text-[22px] font-semibold">
          That page is not here
        </h1>
        <p className="m-0 mt-2 font-public-sans text-[13px] leading-[1.55] text-shell-fg-2">
          The link may be old, or the page may have moved.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/" className="mk-btn-dark" autoFocus>
            Go to the homepage
          </Link>
          <Link to="/signin" className="mk-btn-light">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
