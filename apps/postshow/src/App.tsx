import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { LandingPage } from './pages/marketing/LandingPage';
import { WorkspaceProvider } from './state/WorkspaceContext';
import { AuthGate } from './components/AuthGate';
import { AppShell } from './components/AppShell';
import { AnalyticsConsent } from './components/AnalyticsConsent';

const SecurityPage = lazy(() =>
  import('./pages/marketing/SecurityPage').then((m) => ({ default: m.SecurityPage }))
);
const OpenSourcePage = lazy(() =>
  import('./pages/marketing/OpenSourcePage').then((m) => ({ default: m.OpenSourcePage }))
);
const TermsPage = lazy(() =>
  import('./pages/legal/TermsPage').then((m) => ({ default: m.TermsPage }))
);
const PrivacyPage = lazy(() =>
  import('./pages/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage }))
);
const CookiesPage = lazy(() =>
  import('./pages/legal/CookiesPage').then((m) => ({ default: m.CookiesPage }))
);
const SignInPage = lazy(() =>
  import('./pages/marketing/SignInPage').then((m) => ({ default: m.SignInPage }))
);
const InvitePage = lazy(() =>
  import('./pages/InvitePage').then((m) => ({ default: m.InvitePage }))
);
const InboxPage = lazy(() => import('./pages/InboxPage').then((m) => ({ default: m.InboxPage })));
const IncidentsPage = lazy(() =>
  import('./pages/IncidentsPage').then((m) => ({ default: m.IncidentsPage }))
);
const IncidentPage = lazy(() =>
  import('./pages/IncidentPage').then((m) => ({ default: m.IncidentPage }))
);
const AccountsPage = lazy(() =>
  import('./pages/AccountsPage').then((m) => ({ default: m.AccountsPage }))
);
const FieldNotesPage = lazy(() =>
  import('./pages/FieldNotesPage').then((m) => ({ default: m.FieldNotesPage }))
);
const WorkPlanPage = lazy(() =>
  import('./pages/WorkPlanPage').then((m) => ({ default: m.WorkPlanPage }))
);
const ConnectionsPage = lazy(() =>
  import('./pages/ConnectionsPage').then((m) => ({ default: m.ConnectionsPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);
const DeletionReceiptRecovery = lazy(() =>
  import('./components/settings/WorkspaceLifecycleSection').then((m) => ({
    default: m.DeletionReceiptRecovery,
  }))
);

/** SPA navigations keep the previous scroll position; new routes should
 * start at the top. Hash links (like /#waitlist) keep their anchor scroll. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname, hash]);
  return null;
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-0">
      <span className="mk-eyebrow text-shell-fg-3">loading…</span>
    </div>
  );
}

const DELETION_RECOVERY_ROUTES = new Set([
  '/signin',
  '/inbox',
  '/incidents',
  '/accounts',
  '/field-notes',
  '/work-plan',
  '/connections',
  '/settings',
]);

function RouteScopedDeletionReceiptRecovery() {
  const { pathname } = useLocation();
  return DELETION_RECOVERY_ROUTES.has(pathname) || pathname.startsWith('/incidents/') ? (
    <DeletionReceiptRecovery />
  ) : null;
}

export default function App(): ReactElement {
  return (
    <>
      <WorkspaceProvider>
        <ScrollToTop />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route index element={<LandingPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="open-source" element={<OpenSourcePage />} />
            <Route path="terms" element={<TermsPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="cookies" element={<CookiesPage />} />
            <Route path="signin" element={<SignInPage />} />
            <Route path="invite" element={<InvitePage />} />
            <Route
              element={
                <AuthGate>
                  <AppShell />
                </AuthGate>
              }
            >
              <Route path="inbox" element={<InboxPage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="incidents/:incidentId" element={<IncidentPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="field-notes" element={<FieldNotesPage />} />
              <Route path="work-plan" element={<WorkPlanPage />} />
              <Route path="connections" element={<ConnectionsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
        <Suspense fallback={null}>
          <RouteScopedDeletionReceiptRecovery />
        </Suspense>
      </WorkspaceProvider>
      <AnalyticsConsent />
    </>
  );
}
