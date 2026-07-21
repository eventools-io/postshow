import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const INVITATION_TOKEN_RE = /^psi_[0-9a-f]{64}$/;
let initialBearer: { pathname: string; token: string } | null = null;

function tokenFromHash(hash: string): string {
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = fragment.get('token');
  return fragment.size === 1 && token && INVITATION_TOKEN_RE.test(token) ? token : '';
}

function scrubbedLocation(location: { pathname: string; search: string; hash: string }): string {
  const query = new URLSearchParams(location.search);
  query.delete('invite');
  query.delete('token');
  const fragment = new URLSearchParams(location.hash.slice(1));
  fragment.delete('token');
  const search = query.toString();
  const hash = fragment.toString();
  return `${location.pathname}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`;
}

/** Runs before analytics and React so a cold-load bearer cannot enter SDK
 * context, error recovery storage, or a lazy-chunk request lifecycle. */
export function captureInitialInvitationFragment(): void {
  if (!['/invite', '/signin'].includes(window.location.pathname)) return;
  const current = {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
  const token = tokenFromHash(current.hash);
  if (token) initialBearer = { pathname: current.pathname, token };
  const original = `${current.pathname}${current.search}${current.hash}`;
  const scrubbed = scrubbedLocation(current);
  if (scrubbed !== original) {
    window.history.replaceState(window.history.state, '', scrubbed);
  }
}

/**
 * Keeps an invitation bearer only in component memory, then removes it from
 * the address bar before paint. Legacy query-string bearers are rejected and
 * scrubbed rather than propagated into navigation, analytics, or auth links.
 */
export function useInvitationFragmentToken(): string {
  const location = useLocation();
  const navigate = useNavigate();
  const initialLocation = useRef(location);
  const [token] = useState(
    () =>
      tokenFromHash(initialLocation.current.hash) ||
      (initialBearer?.pathname === initialLocation.current.pathname ? initialBearer.token : '')
  );

  useLayoutEffect(() => {
    const initial = initialLocation.current;
    const current = `${initial.pathname}${initial.search}${initial.hash}`;
    const scrubbed = scrubbedLocation(initial);
    if (
      scrubbed !== current &&
      `${window.location.pathname}${window.location.search}${window.location.hash}` === current
    ) {
      window.history.replaceState(window.history.state, '', scrubbed);
    }
  }, []);

  // React Router activates programmatic navigation in its own layout effect,
  // so synchronize router state on the following effect. The native URL was
  // already scrubbed before paint when this is the browser-backed router.
  useEffect(() => {
    const initial = initialLocation.current;
    const current = `${initial.pathname}${initial.search}${initial.hash}`;
    const scrubbed = scrubbedLocation(initial);
    if (scrubbed !== current) navigate(scrubbed, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (initialBearer?.pathname === initialLocation.current.pathname) initialBearer = null;
  }, []);

  return token;
}
