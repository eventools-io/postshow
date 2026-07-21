import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';

const CHUNK_RELOAD_KEY = 'postshow.chunk-reload.v1';

function isChunkLoadFailure(error: Error): boolean {
  return /(?:failed to fetch dynamically imported module|loading chunk|chunkloaderror|importing a module script failed)/i.test(
    error.message
  );
}

export function chunkReloadMarker(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('invite');
  url.searchParams.delete('token');
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.delete('token');
  const hash = fragment.toString();
  url.hash = hash ? `#${hash}` : '';
  return url.href;
}

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Last-resort UI containment, including one bounded reload for stale deploy assets. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadFailure(error)) {
      const marker = chunkReloadMarker(window.location.href);
      const attemptedFor = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
      if (attemptedFor !== marker) {
        window.sessionStorage.setItem(CHUNK_RELOAD_KEY, marker);
        window.location.reload();
        return;
      }
    }
    console.error('Postshow render failed', error, info.componentStack);
  }

  private reload = (): void => {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-shell-0 px-5 text-shell-fg">
        <div className="w-full max-w-[480px] rounded-lg border border-shell-3 bg-shell-1 p-7">
          <span className="flex items-center gap-[10px] font-public-sans text-[18px] font-semibold">
            <Logo size={22} />
            Postshow
          </span>
          <h1 className="m-0 mt-6 font-public-sans text-[22px] font-semibold">
            Postshow needs a fresh start
          </h1>
          <p
            className="m-0 mt-2 font-public-sans text-[13px] leading-[1.55] text-shell-fg-2"
            role="alert"
          >
            Your work is still saved. Reload the app to pick up the latest version. If this keeps
            happening, support can help.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={this.reload} className="mk-btn-dark" autoFocus>
              Reload Postshow
            </button>
            <Link to="/" className="mk-btn-light">
              Go to the homepage
            </Link>
            <a href="mailto:support@eventools.io" className="mk-btn-light">
              Contact support
            </a>
          </div>
        </div>
      </main>
    );
  }
}

export function clearChunkReloadMarker(): void {
  window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
}
