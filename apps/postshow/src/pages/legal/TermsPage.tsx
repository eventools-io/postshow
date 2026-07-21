import { Link } from 'react-router-dom';
import {
  LEGAL_TEXT_LINK_CLASS,
  LegalCallout,
  LegalList,
  LegalPage,
  LegalSection,
  type LegalSectionLink,
} from '@/components/legal/LegalPage';
import { PAGE_META, usePageMeta } from '@/lib/seo';
import { POSTSHOW_LEGAL_EFFECTIVE_DATE } from '@/lib/legalAcceptance';

const SECTIONS: readonly LegalSectionLink[] = [
  { id: 'agreement', label: 'Agreement and eligibility' },
  { id: 'service', label: 'The Service' },
  { id: 'accounts', label: 'Accounts and workspaces' },
  { id: 'customer-data', label: 'Customer Data' },
  { id: 'ai', label: 'AI and model providers' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'fees', label: 'Fees and billing' },
  { id: 'confidentiality', label: 'Security and confidentiality' },
  { id: 'ownership', label: 'Ownership and feedback' },
  { id: 'suspension', label: 'Suspension and termination' },
  { id: 'warranties', label: 'Warranties' },
  { id: 'liability', label: 'Liability' },
  { id: 'indemnity', label: 'Indemnity' },
  { id: 'disputes', label: 'Law and disputes' },
  { id: 'general', label: 'General terms' },
];

export function TermsPage() {
  usePageMeta(PAGE_META.terms!);
  return (
    <LegalPage
      eyebrow="legal"
      title="Postshow Terms of Service"
      effectiveDate={POSTSHOW_LEGAL_EFFECTIVE_DATE}
      sections={SECTIONS}
      summary={
        <p className="m-0">
          These Terms are the agreement between you and Eventools LLC for Postshow&rsquo;s hosted
          service and account-connected software. They are written for business users. The short
          version: protect your account, connect only data you are allowed to use, review AI output,
          and keep a human responsible for every action.
        </p>
      }
    >
      <LegalSection id="agreement" title="1. Agreement and eligibility">
        <p className="m-0">
          These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between Eventools LLC
          (&ldquo;Eventools,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) and
          the person or organization that accesses Postshow (&ldquo;Customer,&rdquo;
          &ldquo;you,&rdquo; or &ldquo;your&rdquo;). They apply to postshow.io, Postshow accounts,
          the hosted runtime, and Postshow desktop, command-line, and MCP software when those
          surfaces connect to our hosted service (collectively, the &ldquo;Service&rdquo;).
        </p>
        <p className="m-0">
          By creating an account, accepting an order, or using the Service, you accept these Terms.
          If you act for an organization, you represent that you are authorized to bind it. You must
          be at least 18 and legally able to enter this agreement. Postshow is designed for business
          use, not personal, household, or consumer use.
        </p>
        <p className="m-0">
          An order form, enterprise agreement, or data processing addendum signed by both parties
          may add to or override these Terms. If you do not agree, do not use the Service.
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. The Service and open-source software">
        <p className="m-0">
          Postshow gathers information from connections you configure, prepares evidence for a
          model, and stores generated findings, account dossiers, field notes, run records, and
          drafted actions in a shared workspace. Work may run on your device or through our hosted
          runtime, depending on the runtime and plan you choose.
        </p>
        <p className="m-0">
          Source code we publish under the MIT License is governed by that license, not by the
          hosted service license in these Terms. Open-source components are building blocks, not a
          promise of a supported or turnkey self-managed deployment. Eventools is not required to
          provide support, hosting, updates, or compatibility for a deployment you assemble or
          operate.
        </p>
        <p className="m-0">
          We may improve, add, remove, or change features. We will not materially reduce a paid
          plan&rsquo;s core functionality during its current subscription term without reasonable
          notice, except where a change is needed for security, law, provider availability, or to
          prevent harm. No service-level agreement applies unless an order expressly includes one.
        </p>
      </LegalSection>

      <LegalSection id="accounts" title="3. Accounts, workspaces, and authorized users">
        <LegalList>
          <li>Provide accurate account and billing information and keep it current.</li>
          <li>
            Protect passwords, API tokens, device credentials, and recovery methods; do not share an
            individual login.
          </li>
          <li>
            Assign the least workspace role each user needs and promptly remove access that is no
            longer authorized.
          </li>
          <li>
            Tell us promptly at{' '}
            <a href="mailto:security@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
              security@eventools.io
            </a>{' '}
            if you suspect unauthorized access.
          </li>
        </LegalList>
        <p className="m-0">
          Customer is responsible for its authorized users, workspace configuration, connected
          accounts, and activities performed with its credentials. Workspace owners control
          membership, billing, export, and deletion. Transferring ownership and deleting a workspace
          are separate from deleting an individual account.
        </p>
      </LegalSection>

      <LegalSection id="customer-data" title="4. Customer Data and instructions">
        <p className="m-0">
          &ldquo;Customer Data&rdquo; means data, content, credentials, configuration, and source
          information that Customer or its users submit, connect, or direct the Service to process,
          together with outputs generated from that material. As between the parties, Customer keeps
          its rights in Customer Data.
        </p>
        <p className="m-0">
          Customer grants Eventools and its subprocessors a limited, non-exclusive right to host,
          copy, transmit, transform, and otherwise process Customer Data only to provide, secure,
          support, and maintain the Service; comply with law; and follow Customer&rsquo;s documented
          instructions. We do not sell Customer Data or use it for targeted advertising.
        </p>
        <p className="m-0">Customer represents and warrants that it:</p>
        <LegalList>
          <li>
            has all rights, notices, consents, agreements, and lawful bases needed to provide and
            process Customer Data through Postshow;
          </li>
          <li>
            may lawfully access each connected source and instruct Postshow and the selected model
            provider to process its contents;
          </li>
          <li>
            will honor requests and legal obligations relating to personal data for which Customer
            is the controller or business; and
          </li>
          <li>
            will not provide regulated or highly sensitive data unless the parties have first agreed
            in writing to appropriate terms and controls.
          </li>
        </LegalList>
        <p className="m-0">
          Details about data flows, exports, deletion, and retention are in our{' '}
          <Link to="/privacy" className={LEGAL_TEXT_LINK_CLASS}>
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link to="/security" className={LEGAL_TEXT_LINK_CLASS}>
            Security page
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="ai" title="5. AI output and model providers">
        <LegalCallout title="Human review is part of the product contract">
          <p className="m-0">
            Model output can be incomplete, inaccurate, offensive, non-unique, or unsuitable. Review
            the evidence, recipients, content, and consequences before approving or using an output.
            Do not rely on Postshow as the sole basis for legal, employment, credit, insurance,
            healthcare, safety-critical, or similarly significant decisions about a person.
          </p>
        </LegalCallout>
        <p className="m-0">
          The evidence packet for a run may include personal data and confidential business
          information from connected sources. For BYOK runs, it is sent to the model provider and
          account you configure. For hosted runs, it is sent to the model provider selected by the
          hosted runtime, currently from supported Anthropic and OpenAI routes. Provider handling,
          retention, and training terms depend on the applicable provider account and contract.
        </p>
        <p className="m-0">
          A local-only connector keeps its source credential and raw source records out of
          Eventools&rsquo; cloud. It does not, by itself, make a remote model local: if you choose a
          remote model, the local runtime sends the run&rsquo;s evidence packet to that provider. An
          on-device Ollama route keeps model processing on the device.
        </p>
        <p className="m-0">
          Postgres is offered only through the device runtime. Customer configures one bounded,
          read-only <code className="font-public-mono">SELECT</code>, uses a read-only database
          user, and must require TLS for a non-loopback database. The connection string and query
          stay in the device credential store. Returned rows may be included in the evidence packet
          sent to Customer&rsquo;s selected local or BYOK model on that device, while only sanitized
          derived findings sync to the hosted workspace.
        </p>
        <p className="m-0">
          Postshow places supported outbound actions into a review flow for an authorized user. You
          remain responsible for every approved transmission, ticket, email, decision, and other use
          of output, including checking that the action is lawful and appropriate.
        </p>
      </LegalSection>

      <LegalSection id="integrations" title="6. Connections and third-party services">
        <p className="m-0">
          The Service interoperates with providers selected by Customer, including analytics,
          billing, source-control, error-monitoring, issue-tracking, messaging, email, and model
          services. Customer authorizes us to exchange the data and instructions required for each
          enabled integration.
        </p>
        <p className="m-0">
          Third-party services are governed by their own agreements. Eventools does not control and
          is not responsible for a provider&rsquo;s service, availability, changes, data practices,
          or acts and omissions. Removing a connection stops new Postshow access but does not undo
          processing already performed by that provider. We may disable an integration that is
          unsafe, unlawful, unavailable, or no longer supported.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="7. Acceptable use">
        <p className="m-0">You must not, and must not help anyone else to:</p>
        <LegalList>
          <li>use the Service or output unlawfully or to violate another person&rsquo;s rights;</li>
          <li>
            upload malware, attempt unauthorized access, evade rate limits or quotas, probe other
            tenants, or interfere with the Service;
          </li>
          <li>
            access a source, workspace, model account, or recipient without permission, or obtain
            credentials by deception;
          </li>
          <li>
            use Postshow for surveillance, unlawful profiling, discrimination, spam, harassment, or
            high-impact automated decisions without legally required safeguards and human review;
          </li>
          <li>
            process payment-card numbers, authentication secrets, protected health information,
            government identifiers, or other highly sensitive data unless expressly supported and
            covered by a written agreement;
          </li>
          <li>
            reverse engineer the hosted Service, except to the extent a restriction is prohibited by
            law or the relevant open-source license permits it;
          </li>
          <li>
            resell, sublicense, or provide the hosted Service to third parties as a service bureau
            without our written permission; or
          </li>
          <li>
            export, re-export, access, or use the Service in violation of applicable trade controls,
            sanctions, or embargoes.
          </li>
        </LegalList>
        <p className="m-0">
          Security research must be authorized in advance or follow our{' '}
          <a
            href="https://github.com/eventools-io/postshow/security/policy"
            className={LEGAL_TEXT_LINK_CLASS}
          >
            published vulnerability disclosure instructions
          </a>
          . Contact{' '}
          <a href="mailto:security@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            security@eventools.io
          </a>{' '}
          before testing production systems.
        </p>
      </LegalSection>

      <LegalSection id="fees" title="8. Fees, subscriptions, and billing">
        <p className="m-0">
          Plan limits, prices, billing cadence, included usage, and any metered charges shown at
          checkout or in an order form are part of these Terms. Stripe processes self-service
          payment methods and charges. Enterprise usage and billing may be measured and reconciled
          through Metronome and invoiced or collected through Stripe as described in the applicable
          order.
        </p>
        <LegalList>
          <li>
            Subscription fees are billed in advance unless an order states otherwise. Metered fees,
            if any, are billed in arrears from authoritative usage records.
          </li>
          <li>
            Customer is responsible for taxes, except taxes based on Eventools&rsquo; net income,
            and for keeping a valid payment method and billing contact.
          </li>
          <li>
            Paid subscriptions renew for the displayed period until canceled. Cancellation takes
            effect at the end of the current paid period unless the order says otherwise.
          </li>
          <li>
            Except where law or an order requires otherwise, fees are non-refundable and payment
            obligations are non-cancelable.
          </li>
        </LegalList>
        <p className="m-0">
          We may change prices for a future renewal period with at least 30 days&rsquo; notice. We
          may suspend paid features for overdue undisputed amounts after reasonable notice and an
          opportunity to cure.
        </p>
      </LegalSection>

      <LegalSection id="confidentiality" title="9. Security and confidentiality">
        <p className="m-0">
          Each party may receive non-public information that a reasonable person would understand to
          be confidential. The receiving party will use it only to perform or exercise rights under
          this agreement, protect it with reasonable care, and disclose it only to personnel and
          service providers who need it and are bound to protect it. These duties do not cover
          information that was lawfully known without restriction, becomes public without breach, is
          received lawfully from another source, or is independently developed.
        </p>
        <p className="m-0">
          We maintain reasonable administrative, technical, and organizational safeguards described
          on the{' '}
          <Link to="/security" className={LEGAL_TEXT_LINK_CLASS}>
            Security page
          </Link>
          . No internet service is perfectly secure. Customer is responsible for connection scopes,
          endpoint security, local credentials, backups of exported data, and security of its own
          providers and devices.
        </p>
      </LegalSection>

      <LegalSection id="ownership" title="10. Ownership, output, and feedback">
        <p className="m-0">
          Eventools and its licensors own the hosted Service, documentation, branding, and related
          technology, excluding Customer Data and open-source components licensed separately.
          Subject to payment and these Terms, we grant Customer a limited, non-exclusive,
          non-transferable right to use the hosted Service during its subscription.
        </p>
        <p className="m-0">
          To the extent Eventools has rights in an output generated specifically for Customer, we
          assign those rights to Customer upon creation. Similar or identical output may be
          generated for others, and law may not recognize exclusive rights in machine-generated
          material. Customer is responsible for clearance and use of output.
        </p>
        <p className="m-0">
          If you provide feedback, you grant us a perpetual, worldwide, royalty-free right to use it
          without identifying you or disclosing Customer confidential information.
        </p>
      </LegalSection>

      <LegalSection id="suspension" title="11. Suspension, termination, export, and deletion">
        <p className="m-0">
          You may stop using the Service, cancel a paid plan, export an eligible workspace, delete a
          workspace, or delete an eligible account through the available settings. Export your
          workspace before deletion if you need a copy. Workspace deletion and account deletion are
          separate; an account owner must first transfer or delete every workspace it owns.
        </p>
        <p className="m-0">
          We may suspend or limit access immediately when reasonably necessary to address a security
          incident, prevent harm, comply with law, protect other customers, or stop a material
          breach. Otherwise, either party may terminate for a material breach that remains uncured
          30 days after written notice. We will use reasonable efforts to narrow a suspension and
          restore access when the cause is resolved.
        </p>
        <p className="m-0">
          Deletion may remain in progress while running work becomes quiescent and billing-provider
          resources are reconciled. Active tenant content, credentials, tokens, and provider
          resources are removed when deletion completes. Limited redacted billing, fraud, security,
          and deletion evidence may be retained as described in the Privacy Policy. Provisions that
          by their nature should survive termination will survive, including payment,
          confidentiality, ownership, warranty, liability, indemnity, and dispute provisions.
        </p>
      </LegalSection>

      <LegalSection id="warranties" title="12. Disclaimers and warranties">
        <p className="m-0 font-semibold text-shell-fg">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE, OPEN-SOURCE COMPONENTS, MODEL OUTPUT,
          AND THIRD-PARTY INTEGRATIONS ARE PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
          AVAILABLE.&rdquo; EVENTOOLS DISCLAIMS ALL IMPLIED OR STATUTORY WARRANTIES, INCLUDING
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
        </p>
        <p className="m-0">
          We do not warrant that the Service will be uninterrupted, error-free, or completely
          secure; that a provider will remain available; that source data or output is accurate or
          complete; or that an output will be lawful, unique, or suitable for Customer&rsquo;s
          purpose. Nothing in these Terms excludes a warranty that cannot legally be excluded.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="13. Limitation of liability">
        <p className="m-0 font-semibold text-shell-fg">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY WILL BE LIABLE FOR LOST PROFITS,
          REVENUE, GOODWILL, OR DATA; BUSINESS INTERRUPTION; OR INDIRECT, INCIDENTAL, SPECIAL,
          CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, EVEN IF ADVISED THAT THEY WERE POSSIBLE.
        </p>
        <p className="m-0 font-semibold text-shell-fg">
          EACH PARTY&rsquo;S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE SERVICE OR
          THESE TERMS WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS CUSTOMER PAID OR OWED FOR THE
          SERVICE DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY OR (B) USD $100.
        </p>
        <p className="m-0">
          These limitations do not apply to Customer&rsquo;s payment obligations, a party&rsquo;s
          indemnification obligations, fraud, willful misconduct, or liabilities that applicable law
          does not permit the parties to limit.
        </p>
      </LegalSection>

      <LegalSection id="indemnity" title="14. Indemnification">
        <p className="m-0">
          Customer will defend Eventools and its affiliates, officers, employees, and contractors
          against third-party claims arising from Customer Data, Customer&rsquo;s connected sources
          or approved actions, or Customer&rsquo;s material breach of these Terms, and will pay
          damages, costs, and reasonable legal fees finally awarded or agreed in a settlement
          Customer approves. Eventools will promptly notify Customer, provide reasonable cooperation
          at Customer&rsquo;s expense, and allow Customer to control the defense, provided a
          settlement may not admit fault by or impose obligations on Eventools without our written
          consent.
        </p>
      </LegalSection>

      <LegalSection id="disputes" title="15. Governing law and disputes">
        <p className="m-0">
          These Terms are governed by Delaware law, without regard to conflict-of-law rules. Before
          filing a formal claim, each party will give the other written notice and try in good faith
          for 30 days to resolve the dispute.
        </p>
        <p className="m-0">
          If the dispute is not resolved, it will be decided by binding arbitration administered by
          the American Arbitration Association under its applicable commercial rules, in Delaware,
          in English, by one arbitrator. Either party may seek injunctive relief in a court of
          competent jurisdiction to protect intellectual property, confidential information, or
          system security.
        </p>
        <p className="m-0 font-semibold text-shell-fg">
          TO THE EXTENT PERMITTED BY LAW, CLAIMS MAY BE BROUGHT ONLY ON AN INDIVIDUAL BASIS, NOT AS
          A PLAINTIFF OR CLASS MEMBER IN A CLASS, COLLECTIVE, CONSOLIDATED, OR REPRESENTATIVE
          ACTION.
        </p>
      </LegalSection>

      <LegalSection id="general" title="16. General terms and contact">
        <p className="m-0">
          Neither party may assign these Terms without the other&rsquo;s consent, except in
          connection with a merger, reorganization, sale of substantially all assets, or transfer to
          an affiliate that assumes the obligations. The parties are independent contractors. These
          Terms create no third-party beneficiary rights.
        </p>
        <p className="m-0">
          If a provision is unenforceable, it will be limited to the minimum extent necessary and
          the rest will remain effective. A waiver must be in writing and is not a continuing
          waiver. Neither party is liable for delay caused by events beyond its reasonable control,
          excluding payment obligations. Headings are for convenience only.
        </p>
        <p className="m-0">
          We may update these Terms. For a material change, we will provide at least 30 days&rsquo;
          notice by email or in-product notice unless law or an urgent security change requires
          faster action. Continued use after the effective date means you accept the updated Terms.
        </p>
        <p className="m-0">
          These Terms, the{' '}
          <Link to="/privacy" className={LEGAL_TEXT_LINK_CLASS}>
            Privacy Policy
          </Link>
          , applicable order, and any signed addendum are the complete agreement for the Service and
          replace prior Postshow terms on the same subject. Questions and legal notices may be sent
          to{' '}
          <a href="mailto:support@eventools.io" className={LEGAL_TEXT_LINK_CLASS}>
            support@eventools.io
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
