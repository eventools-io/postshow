import { Link } from 'react-router-dom';
import {
  LEGAL_TEXT_LINK_CLASS,
  LegalCallout,
  LegalDefinitionGrid,
  LegalList,
  LegalPage,
  LegalSection,
  type LegalSectionLink,
} from '@/components/legal/LegalPage';
import { openAnalyticsPreferences } from '@/lib/analytics';
import { PAGE_META, usePageMeta } from '@/lib/seo';
import { POSTSHOW_LEGAL_EFFECTIVE_DATE } from '@/lib/legalAcceptance';

const SECTIONS: readonly LegalSectionLink[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'essential', label: 'Essential storage' },
  { id: 'analytics', label: 'Optional analytics' },
  { id: 'providers', label: 'Provider technologies' },
  { id: 'choices', label: 'Your choices' },
  { id: 'signals', label: 'Browser privacy signals' },
  { id: 'changes', label: 'Changes and contact' },
];

export function CookiesPage() {
  usePageMeta(PAGE_META.cookies!);
  return (
    <LegalPage
      eyebrow="browser privacy"
      title="Cookies and Local Storage Notice"
      effectiveDate={POSTSHOW_LEGAL_EFFECTIVE_DATE}
      sections={SECTIONS}
      summary={
        <p className="m-0">
          Postshow uses a small amount of browser storage to keep you signed in, make sensitive
          operations recoverable, and remember your privacy choice. Product analytics stay off until
          you opt in. We do not use advertising cookies. Session replay runs only after consent and
          masks page text and all form fields.
        </p>
      }
    >
      <LegalSection id="overview" title="1. What this Notice covers">
        <p className="m-0">
          This Notice explains cookies and similar technologies used by postshow.io and the Postshow
          web app. &ldquo;Browser storage&rdquo; includes cookies, localStorage, and sessionStorage.
          localStorage persists until it is removed; sessionStorage normally lasts for the current
          tab. A cookie is sent to its issuing domain with matching requests.
        </p>
        <p className="m-0">
          Most first-party Postshow state is stored in localStorage or sessionStorage rather than a
          browser cookie. Our providers may use cookies or comparable device storage in
          authentication, security, analytics, or payment flows. The exact names used by a provider
          can change as its service evolves.
        </p>
      </LegalSection>

      <LegalSection id="essential" title="2. Essential Postshow storage">
        <p className="m-0">
          These entries are necessary to provide a function you request or to protect a sensitive
          operation. They do not depend on analytics consent.
        </p>
        <LegalDefinitionGrid
          items={[
            {
              term: 'sb-…-auth-token (localStorage)',
              detail:
                'Supabase session and refresh information used to keep you signed in and refresh an authenticated session. It remains until sign-out, account deletion, expiration, or browser-data clearing.',
            },
            {
              term: 'postshow.selected-workspace-id (localStorage)',
              detail:
                'Remembers the workspace you selected. It remains until you select another workspace, lose access, or clear browser data.',
            },
            {
              term: 'postshow.operation.* (sessionStorage)',
              detail:
                'Random request identifiers that make uncertain billing and membership responses replay-safe and keep deletion begin or cancellation requests idempotent while Postshow recovers their authoritative server status. Each key is scoped to one operation and contains no credential or invitation bearer. Entries are cleared when the product has a confirmed result and starts a new operation, or when the tab session ends.',
            },
            {
              term: 'postshow.operation.invitation:<sha256> (sessionStorage)',
              detail:
                'Keeps only a random invitation-request UUID so a workspace owner can safely retry a lost response in the same tab. The key suffix hashes the workspace ID, canonical invitee email, role, and exact expiry; neither the raw email nor the invitation bearer is stored. It is replaced when the owner explicitly starts another invite and otherwise expires with the tab. If sessionStorage is unavailable, the same value is kept only in memory.',
            },
            {
              term: 'postshow.billing-handoff.* (localStorage)',
              detail:
                'Lets the app recover a checkout, billing-portal, or payment-confirmation handoff after navigation. Entries expire from app use after two minutes and are removed after reconciliation.',
            },
            {
              term: 'postshow.workspace-export.* (localStorage)',
              detail:
                'Stores only an export request ID and random begin/cancel retry keys so a large asynchronous export can be resumed, downloaded, or removed safely after navigation. It never stores exported records, checksums, credentials, or the short-lived signed download URL. Download access ends 24 hours after an export becomes ready. Deletion of the private server copy then starts and is retried until storage verifies that the artifact is absent; the entry is cleared only after that verified expiry/removal result, or when you acknowledge a failed export by preparing another one. If localStorage is missing or blocked, Postshow can rediscover the current active export from authenticated server state.',
            },
            {
              term: 'postshow.workspace-deletion.* (localStorage)',
              detail:
                'Stores a deletion request ID and idempotent begin key under the opaque authenticated user ID so Postshow can recover authoritative progress automatically, offer cancellation when allowed, and verify completion after navigation without exposing it to another signed-in user in the same browser. It is removed after the operation is completed and acknowledged or canceled.',
            },
            {
              term: 'postshow.workspace-deletion-recovery.v1.<user-id> (localStorage)',
              detail:
                'A bounded, authenticated-user-scoped list of deletion request references used to recover an authoritative completion receipt even if workspace access disappears during deletion. Switching accounts cannot read or clear another user’s list.',
            },
            {
              term: 'postshow.chunk-reload.v1 (sessionStorage)',
              detail:
                'Prevents a stale application chunk from causing an endless reload loop. It records one attempted URL and is cleared after a successful startup.',
            },
          ]}
        />
        <LegalCallout title="Clearing storage does not cancel server-side work">
          <p className="m-0">
            Clearing essential storage may sign you out, forget the selected workspace, or remove a
            browser replay key. Work already accepted by the Service keeps its authoritative
            server-side state. After you sign back in, Postshow can rediscover the current active
            workspace export or workspace deletion; contact support if another operation cannot be
            recovered in-product.
          </p>
        </LegalCallout>
        <LegalCallout title="Invitation bearers are not browser storage">
          <p className="m-0">
            A workspace invitation bearer arrives after the{' '}
            <code className="font-public-mono">#</code> fragment in the invitation link. Postshow
            reads it into component memory and immediately removes the fragment from the visible
            URL. The bearer is not copied into a query string, authentication redirect URL,
            localStorage, or sessionStorage. Acceptance sends only its SHA-256 digest to the
            workspace database. Reloading or leaving the page clears the in-memory bearer, so the
            original invitation link must be opened again.
          </p>
        </LegalCallout>
      </LegalSection>

      <LegalSection id="analytics" title="3. Optional product analytics">
        <p className="m-0">
          Postshow analytics are disabled by default. Until you choose &ldquo;Accept
          analytics,&rdquo; the PostHog client is not loaded and no PostHog product event is sent.
          Authentication, billing, connectors, local work, export, and deletion continue to work if
          you decline.
        </p>
        <LegalDefinitionGrid
          items={[
            {
              term: 'postshow.analytics-consent.v1 (localStorage)',
              detail:
                'Stores accepted or declined so the app can honor the choice on later visits. It remains until you change the choice or clear browser data.',
            },
            {
              term: 'ph_…_posthog and PostHog opt-in state (localStorage)',
              detail:
                'Created only after acceptance to maintain a pseudonymous analytics identity and consent state. Withdrawing consent resets the analytics identity and stops future capture; clearing browser data also removes it.',
            },
          ]}
        />
        <p className="m-0">
          With consent, PostHog records manually instrumented events, autocaptured interactions,
          page views and exits, dead and rage clicks, exceptions, web performance, heatmaps, and
          session replay. Replay masks all page text and every form field. Console logs, request and
          response bodies, request headers, canvas content, and cross-origin frames are not
          recorded. URL queries and fragments are removed before events are sent. We may associate
          events with an opaque authentication user ID, but do not send names, email addresses,
          connector data, prompts, or model output as analytics properties.
        </p>
        <button type="button" onClick={openAnalyticsPreferences} className="mk-btn-dark">
          Open analytics choices
        </button>
      </LegalSection>

      <LegalSection id="providers" title="4. Provider cookies and device technologies">
        <LegalDefinitionGrid
          items={[
            {
              term: 'Stripe payment technology',
              detail:
                'Stripe Checkout, Elements, Link, and fraud-prevention services may use cookies or device signals such as m, __stripe_mid, __stripe_sid, payment-session, or Link authentication entries. Which entries appear depends on the payment flow and Stripe configuration. Stripe uses them for secure payment, authentication, fraud prevention, and service analytics under its own privacy notice.',
            },
            {
              term: 'Supabase authentication',
              detail:
                'Supabase provides the session represented in localStorage and processes authentication requests. It may also create short-lived infrastructure or security state needed to complete an authentication flow.',
            },
            {
              term: 'Netlify delivery logs',
              detail:
                'Netlify serves the site and may process IP address, user agent, request path, time, and security signals in server and edge logs. Those logs are not browser cookies and are not controlled by the analytics preference.',
            },
          ]}
        />
        <p className="m-0">
          Provider technology is limited to the flow in which the provider is used. A provider can
          update its cookie names, durations, or practices. Review the applicable provider&rsquo;s
          notice during payment or security flows for its current inventory.
        </p>
      </LegalSection>

      <LegalSection id="choices" title="5. How to manage your choices">
        <LegalList>
          <li>
            Use the persistent <strong className="text-shell-fg">Privacy choices</strong> control or
            the button above to accept, decline, or change optional analytics.
          </li>
          <li>
            Use browser settings to view, block, or delete cookies, localStorage, and
            sessionStorage. Blocking essential storage can prevent sign-in and recovery features
            from working.
          </li>
          <li>
            Manage Link and other payment preferences in the Stripe interface. Blocking
            Stripe&rsquo;s necessary fraud-prevention technology may prevent payment confirmation.
          </li>
          <li>
            Sign out on a shared device and clear site data if another person should not recover
            your authenticated session or local operation references.
          </li>
        </LegalList>
        <p className="m-0">
          Analytics withdrawal stops future PostHog collection from that browser. It does not
          require us to erase lawfully collected historical analytics immediately, but you may
          request deletion under the{' '}
          <Link to="/privacy" className={LEGAL_TEXT_LINK_CLASS}>
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="signals" title="6. Do Not Track and Global Privacy Control">
        <p className="m-0">
          Browser Do Not Track is not a uniform legal or technical standard. We do not change core
          Service behavior in response to it because optional PostHog analytics are already off
          until explicit opt-in, and we do not sell personal information or share it for
          cross-context behavioral advertising. The same default is consistent with the privacy
          intent of Global Privacy Control. You can always make an explicit analytics choice in
          Postshow.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="7. Changes and contact">
        <p className="m-0">
          We may update this Notice when storage, providers, or law changes. We will update the
          effective date and re-prompt for consent if a change materially expands optional tracking
          where consent is required.
        </p>
        <p className="m-0">
          Questions about browser storage or privacy choices may be sent to Eventools LLC at{' '}
          <a href="mailto:support@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            support@eventools.io
          </a>
          . For the full data-use explanation, read the{' '}
          <Link to="/privacy" className={LEGAL_TEXT_LINK_CLASS}>
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
