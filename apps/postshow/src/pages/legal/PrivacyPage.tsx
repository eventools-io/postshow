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
import { PAGE_META, usePageMeta } from '@/lib/seo';
import { POSTSHOW_LEGAL_EFFECTIVE_DATE } from '@/lib/legalAcceptance';

const SECTIONS: readonly LegalSectionLink[] = [
  { id: 'scope', label: 'Scope and roles' },
  { id: 'collect', label: 'Information we collect' },
  { id: 'sources', label: 'Connected sources' },
  { id: 'models', label: 'Models and local-only data' },
  { id: 'use', label: 'How we use information' },
  { id: 'share', label: 'Service providers' },
  { id: 'analytics', label: 'Analytics and cookies' },
  { id: 'retention', label: 'Retention' },
  { id: 'export-delete', label: 'Export and deletion' },
  { id: 'rights', label: 'Your rights' },
  { id: 'transfers', label: 'International transfers' },
  { id: 'security', label: 'Security and children' },
  { id: 'changes', label: 'Changes and contact' },
];

const PROVIDERS = [
  {
    term: 'Supabase',
    detail:
      'Authentication, hosted database, encrypted secret storage, realtime, and server-side functions.',
  },
  {
    term: 'Netlify',
    detail:
      'Delivery of the postshow.io site and web-app shell, beta-signup form collection, and ordinary request and security logs.',
  },
  {
    term: 'Stripe',
    detail:
      'Checkout, payment methods, subscription management, invoices, tax and fraud signals, and billing events.',
  },
  {
    term: 'Metronome',
    detail:
      'Enterprise usage metering, contract and rate-card reconciliation, and invoice-supporting usage records.',
  },
  {
    term: 'Resend',
    detail:
      'Transactional and service email, including recipient address, message content, and delivery metadata.',
  },
  {
    term: 'PostHog',
    detail:
      'Optional product events, interactions, page navigation, errors, performance, heatmaps, and masked session replay only after consent.',
  },
  {
    term: 'Selected model providers',
    detail:
      'Evidence packets, prompts, and generated output. Hosted routes currently use supported Anthropic or OpenAI accounts; BYOK routes use the provider and account you configure.',
  },
] as const;

export function PrivacyPage() {
  usePageMeta(PAGE_META.privacy!);
  return (
    <LegalPage
      eyebrow="privacy"
      title="Postshow Privacy Policy"
      effectiveDate={POSTSHOW_LEGAL_EFFECTIVE_DATE}
      sections={SECTIONS}
      summary={
        <p className="m-0">
          Eventools LLC built Postshow to analyze business product data without hiding the route it
          takes. This Policy explains what we collect, when a selected model provider sees an
          evidence packet, what stays on your device, and how workspace export and deletion work.
        </p>
      }
    >
      <LegalSection id="scope" title="1. Scope and our privacy roles">
        <p className="m-0">
          This Privacy Policy applies to postshow.io, Postshow accounts and workspaces, the hosted
          runtime, and Postshow desktop, CLI, and MCP software when they communicate with our hosted
          service (the &ldquo;Service&rdquo;). Eventools LLC is responsible for this Policy.
        </p>
        <p className="m-0">
          We act as a <strong className="text-shell-fg">controller or business</strong> for account,
          waitlist, billing, support, security, and optional product-analytics information that we
          use for our own operational purposes. When a business customer directs Postshow to process
          personal data from its connected sources, we generally act as its{' '}
          <strong className="text-shell-fg">processor or service provider</strong>. That customer
          decides why the data is processed and is responsible for required notices, lawful bases,
          and responses to its end users.
        </p>
        <p className="m-0">
          If you are an individual whose information appears in a customer&rsquo;s connected source
          or Postshow workspace, direct your request to that customer first. We will assist the
          customer as required by applicable law and contract.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="2. Information we collect">
        <LegalDefinitionGrid
          items={[
            {
              term: 'Account and workspace information',
              detail:
                'Email address, authentication identifiers, workspace name, role, invitations, preferences, and configuration.',
            },
            {
              term: 'Customer content and outputs',
              detail:
                'Connection metadata, engine settings, agent instructions, evidence summaries, inbox drafts, field notes, dossiers, work plans, and run records.',
            },
            {
              term: 'Credentials and tokens',
              detail:
                'Connector keys, model keys, API tokens, and device credentials. Cloud credentials are stored as encrypted or hashed values and are not displayed back to clients.',
            },
            {
              term: 'Billing and usage',
              detail:
                'Plan, subscription state, invoices, billing contact, payment status, metered units, and provider references. Stripe, not Eventools, stores complete card numbers.',
            },
            {
              term: 'Communications',
              detail:
                'Waitlist email, support and security messages, feedback, service notices, and transactional email delivery events.',
            },
            {
              term: 'Technical and security information',
              detail:
                'IP address, browser and device information, request time, endpoint, error and abuse signals, and audit records generated by hosting and application infrastructure.',
            },
            {
              term: 'Optional product analytics',
              detail:
                'Product events, interactions, page navigation, errors, performance, heatmaps, and masked session replay after you consent, plus an opaque account identifier when signed in. We do not send names or email addresses to PostHog.',
            },
            {
              term: 'Deletion evidence',
              detail:
                'Request state, timestamps, outcome hashes, and limited redacted billing and deletion proof needed for recovery, accounting, and fraud controls.',
            },
          ]}
        />
        <p className="m-0">
          We also receive information when your organization invites you, when a payment provider
          reports a transaction or subscription event, and when you authorize a connected source or
          model provider to respond to Postshow.
        </p>
      </LegalSection>

      <LegalSection id="sources" title="3. Connected-source information">
        <p className="m-0">
          Postshow reads only the sources and scopes Customer configures. Depending on the
          connection, source data can include product-event sequences, session identifiers, URLs,
          account and subscription details, customer names and email addresses, error records,
          recent code-change metadata, issue content, and outbound recipient information.
        </p>
        <p className="m-0">
          Cloud-run connections send the records needed for a run through Eventools&rsquo; hosted
          runtime. We store connection configuration and generated Postshow records, but the normal
          run path is designed to retain findings and evidence summaries rather than a warehouse
          copy of raw source rows. A source provider may retain its original data under
          Customer&rsquo;s agreement with that provider.
        </p>
        <p className="m-0">
          Postgres is available only through the device runtime. Its connection string and one
          owner-configured, bounded read-only <code className="font-public-mono">SELECT</code>{' '}
          remain in the operating system credential store, and a non-loopback database must
          explicitly require TLS. Query rows can enter the evidence packet processed by the local or
          BYOK model selected on that device. If the BYOK model is remote, that provider receives
          the rows directly from the device. Only sanitized derived findings sync to
          Eventools&rsquo; cloud.
        </p>
        <p className="m-0">
          Customer-directed outbound connections, such as Resend, GitHub, Linear, or Slack, receive
          the content and destination needed for an action only when the applicable product flow
          authorizes that transmission. Removing a connection stops new Postshow access; it does not
          erase information already held by the source or destination provider.
        </p>
      </LegalSection>

      <LegalSection id="models" title="4. Model providers and the local-only boundary">
        <LegalCallout title="Local-only is a Postshow cloud boundary, not a model-provider promise">
          <p className="m-0">
            For a local-only connection, the source credential and raw source records stay on the
            device running Postshow and do not sync to Eventools&rsquo; cloud. The runtime still
            needs a model to do the work. If Customer selects a remote model, the evidence packet is
            sent directly from that device to the selected provider. Selecting local Ollama keeps
            that model processing on the device.
          </p>
        </LegalCallout>
        <p className="m-0">
          Evidence packets are purpose-built inputs derived from connected data. They may contain
          personal data, account identifiers, event sequences, source excerpts, or confidential
          business context required for the run, including bounded rows returned by a configured
          Postgres query. Generated output returns to the runtime and sanitized derived findings may
          sync into the Postshow workspace.
        </p>
        <p className="m-0">
          BYOK calls use Customer&rsquo;s model key, provider account, endpoint, and provider terms.
          Hosted calls use an Eventools-configured provider route. Retention, abuse monitoring, and
          model-training treatment are governed by the terms and account settings that apply to that
          specific route. We do not describe a route as zero-retention or excluded from training
          unless the applicable terms and settings support that statement.
        </p>
      </LegalSection>

      <LegalSection id="use" title="5. How we use information">
        <LegalList>
          <li>provide, authenticate, secure, support, and maintain the Service;</li>
          <li>run scheduled or requested work and generate Customer-directed outputs;</li>
          <li>manage workspace membership, permissions, plans, quotas, and billing;</li>
          <li>send requested waitlist, account, security, billing, and service communications;</li>
          <li>
            diagnose failures, prevent fraud and abuse, enforce our Terms, and protect users and the
            Service;
          </li>
          <li>
            improve Postshow using optional product analytics after consent and aggregated or
            de-identified operational information; and
          </li>
          <li>comply with law, legal process, tax, accounting, and recordkeeping obligations.</li>
        </LegalList>
        <p className="m-0">
          Where law requires a legal basis, we rely on performance of our contract, legitimate
          interests in operating and securing a B2B service, consent for optional analytics and
          requested marketing, and compliance with legal obligations. You may withdraw consent at
          any time without affecting earlier lawful processing.
        </p>
        <p className="m-0">
          We do not sell personal information, share it for cross-context behavioral advertising, or
          use Postshow customer content for targeted advertising.
        </p>
      </LegalSection>

      <LegalSection id="share" title="6. Providers and disclosures">
        <p className="m-0">
          We disclose information to providers that help us operate the Service and to integrations
          Customer directs us to use. The data varies by purpose and is limited to what the service
          requires.
        </p>
        <LegalDefinitionGrid items={PROVIDERS} />
        <p className="m-0">
          We may also disclose information to professional advisers under confidentiality duties; in
          a merger, financing, acquisition, reorganization, or sale of assets; to comply with lawful
          process; or when reasonably necessary to protect rights, safety, and the Service. Where
          legally permitted, we will direct a government request to the Customer or notify Customer
          before disclosing its data.
        </p>
        <p className="m-0">
          A current provider may use its own subprocessors. Provider terms, locations, and
          subprocessors can change. If your organization needs a signed data processing addendum or
          provider-specific review, contact{' '}
          <a href="mailto:security@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            security@eventools.io
          </a>{' '}
          before enabling regulated or hosted processing.
        </p>
      </LegalSection>

      <LegalSection id="analytics" title="7. Optional analytics, cookies, and similar storage">
        <p className="m-0">
          Postshow&rsquo;s PostHog analytics are off until you make an affirmative choice. If you
          accept, we load the analytics client and may associate events with an opaque
          authentication user ID. PostHog then records product events, interactions, page
          navigation, dead and rage clicks, errors, web performance, heatmaps, and session replay.
          Replay masks all page text and every form field. Console logs, network payloads and
          headers, canvas content, and cross-origin frames are excluded, and URL queries and
          fragments are removed before events are sent. We do not send your name, email address,
          connector content, prompts, or model output as analytics properties.
        </p>
        <p className="m-0">
          Authentication, workspace selection, safe operation retries, billing handoff, invitation
          request retries, asynchronous export recovery, and deletion recovery use browser local or
          session storage because they are necessary to provide the requested function. Export
          recovery stores only request references and random retry keys, never exported data or a
          signed download URL. An invitation bearer received in a URL fragment is immediately
          removed from the URL, held only in component memory, and never copied to a query string,
          authentication redirect URL, or browser storage. Stripe and Supabase may use their own
          essential browser technologies in payment and authentication flows. See the{' '}
          <Link to="/cookies" className={LEGAL_TEXT_LINK_CLASS}>
            Cookies and Local Storage Notice
          </Link>{' '}
          for the current inventory and controls.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="8. Retention">
        <p className="m-0">
          We retain personal data for the shortest period reasonably needed for the purposes above,
          taking into account the Service relationship, the sensitivity of the data, security and
          fraud risks, provider capabilities, and legal, tax, accounting, and dispute obligations.
          In particular:
        </p>
        <LegalList>
          <li>
            active workspace configuration, generated records, membership, and account data remain
            while the account or workspace is active and are removed through the deletion processes
            described below;
          </li>
          <li>
            cloud credential values remain until replaced, disconnected, or deleted; one-way token
            hashes and revocation records may remain as needed to prevent reuse and prove
            revocation;
          </li>
          <li>
            waitlist contact information remains until we send the requested launch notice, you ask
            us to delete it, or it is no longer useful, subject to a minimal suppression record
            where needed to honor an opt-out;
          </li>
          <li>
            optional analytics remain only for the configured PostHog retention period and our
            product-improvement need; withdrawing consent stops future collection and resets the
            local analytics identity;
          </li>
          <li>
            a workspace deletion completion receipt is available to the requester for 30 days; and
          </li>
          <li>
            legal acceptance evidence keeps the pseudonymous authentication actor ID, the exact
            Terms and Privacy Policy versions, the acceptance context, the server acceptance time,
            and its retention-expiry time for seven years from acceptance. It does not keep an email
            address, IP address, user agent, device identifier, or browser identifier; and
          </li>
          <li>
            limited redacted financial, fraud-control, usage-settlement, and deletion evidence is
            retained for seven years. It excludes credential values, bearer tokens, raw provider
            receipts, and internal provider routing identifiers.
          </li>
        </LegalList>
        <p className="m-0">
          Service providers may keep transient logs or encrypted backups under their own documented
          cycles. Data isolated in a backup is not restored to active use except for disaster
          recovery and is deleted or overwritten through the provider&rsquo;s normal lifecycle. We
          may retain information longer when required by law, a valid preservation order, or a
          dispute, and will restrict it to that purpose.
        </p>
      </LegalSection>

      <LegalSection id="export-delete" title="9. Workspace export, deletion, and account deletion">
        <p className="m-0">
          A workspace owner can request the complete customer-visible workspace record as
          newline-delimited JSON (NDJSON) from Settings. The Service seals one consistent database
          snapshot, uploads bounded parts to private storage, and provides a signed download URL
          that expires within one minute. An already issued bearer URL may remain usable during that
          bounded period unless its storage object is removed first. Download access to the private
          artifact expires after 24 hours, at which point deletion begins automatically; the
          requesting owner can begin deletion sooner. Deletion is retried until storage confirms
          that the object is absent. The response includes an integrity manifest with per-part
          SHA-256 values. The export includes workspace settings, members, connections, engine
          settings, generated records, schedules, run history, subscription and usage information.
          For security, it excludes credential values, bearer tokens, worker claims, raw provider
          receipts, and internal provider routing identifiers. Customer-configured connector targets
          such as a repository or analytics project remain in the export because they are part of
          the workspace configuration.
        </p>
        <p className="m-0">
          Workspace deletion is an authenticated, owner-only workflow. It waits for running work and
          unsettled usage to become safe, closes active billing-provider resources, deletes tenant
          content and secrets, and produces a verifiable redacted receipt. Until completion,
          Settings recovers and shows the authoritative status automatically and offers cancellation
          when the server still allows it. A dead-lettered deletion stops for an audited support or
          operator recovery after the underlying cause is corrected; it cannot be retried from the
          user interface.
        </p>
        <p className="m-0">
          Account deletion is separate. A user who still owns a workspace must first transfer or
          delete it so deleting the account cannot strand another customer&rsquo;s data or billing.
          When eligible account deletion completes, the Service removes the Postshow profile and
          authentication account and provides a receipt. The limited pseudonymous legal acceptance
          evidence described above remains until its seven-year retention expiry so Eventools can
          establish the agreement that governed use of the business Service.
        </p>
        <p className="m-0">
          For help with an export or deletion that cannot be completed in-product, contact{' '}
          <a href="mailto:support@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            support@eventools.io
          </a>{' '}
          from the account email. We will verify identity and authority before acting.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="10. Your privacy rights and choices">
        <p className="m-0">
          Depending on where you live and subject to legal exceptions, you may have rights to know
          or access personal data; correct it; delete it; receive a portable copy; restrict or
          object to processing; withdraw consent; opt out of sale, sharing, or targeted advertising;
          and appeal a denied request. We do not discriminate against anyone for exercising a
          privacy right.
        </p>
        <LegalList>
          <li>Manage optional analytics at any time with the Privacy choices control.</li>
          <li>Update account and workspace information in Settings where available.</li>
          <li>Use workspace export and deletion tools before deleting an account.</li>
          <li>
            Send other requests to{' '}
            <a href="mailto:support@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
              support@eventools.io
            </a>{' '}
            with &ldquo;Postshow privacy request&rdquo; in the subject.
          </li>
        </LegalList>
        <p className="m-0">
          We may ask for information needed to verify identity, account control, and authority. An
          authorized agent must provide proof of authority, and we may still verify the request with
          the individual. If we process data only for a Customer, we will direct the request to that
          Customer unless law requires otherwise. You may also complain to your local privacy
          regulator.
        </p>
      </LegalSection>

      <LegalSection id="transfers" title="11. International data transfers">
        <p className="m-0">
          Eventools and many of our providers operate in the United States, and providers may
          process information in other countries. Those countries may have privacy laws different
          from yours. Where required, we use recognized transfer mechanisms and contractual
          safeguards, such as standard contractual clauses, through our provider agreements or a
          customer DPA.
        </p>
      </LegalSection>

      <LegalSection id="security" title="12. Security and children">
        <p className="m-0">
          We use safeguards designed for the nature of the Service, including encrypted transport,
          access controls, tenant isolation, encrypted secret storage, scoped runtime access,
          revocable tokens, audit records, and deletion controls. No storage or transmission method
          is completely secure. See our{' '}
          <Link to="/security" className={LEGAL_TEXT_LINK_CLASS}>
            Security page
          </Link>{' '}
          or report a concern to{' '}
          <a href="mailto:security@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            security@eventools.io
          </a>
          .
        </p>
        <p className="m-0">
          Postshow is a B2B service and is not directed to children under 18. Do not create an
          account or intentionally provide a child&rsquo;s personal data. If you believe a child has
          provided account information to us, contact support so we can investigate and delete it
          where required.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes and contact">
        <p className="m-0">
          We may update this Policy as the Service, providers, or law changes. We will post the new
          effective date and provide a prominent in-product or email notice before a material change
          where required. Earlier versions may be requested from support.
        </p>
        <p className="m-0">
          Privacy questions and requests: Eventools LLC, United States,{' '}
          <a href="mailto:support@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            support@eventools.io
          </a>
          . Security and DPA questions:{' '}
          <a href="mailto:security@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            security@eventools.io
          </a>
          . Your use of Postshow is also governed by the{' '}
          <Link to="/terms" className={LEGAL_TEXT_LINK_CLASS}>
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
