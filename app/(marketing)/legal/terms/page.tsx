export default function TermsOfServicePage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        padding: '100px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Legal
          </div>
          <h1 style={{
            fontSize: 'clamp(2rem, 4vw, 3rem)',
            fontWeight: 800, color: '#fff',
            lineHeight: 1.1, marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}>
            Terms of Service
          </h1>
          <p style={{
            fontSize: '1rem', color: '#94a3b8',
            lineHeight: 1.75,
          }}>
            Last updated April 4, 2026
          </p>
        </div>
      </section>

      {/* CONTENT */}
      <section style={{ padding: '64px 24px' }}>
        <div style={{
          maxWidth: '900px', margin: '0 auto',
          background: '#fff', borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: '48px',
        }}>

          <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '40px' }}>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of the DevControl platform
            and services provided by DevControl, Inc. (&quot;DevControl,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
            Please read these Terms carefully before using DevControl.
          </p>

          {/* Section 1 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              1. Acceptance of Terms
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              By creating an account or otherwise accessing or using DevControl, you agree to be bound
              by these Terms and our Privacy Policy. If you are using DevControl on behalf of an
              organization, you represent that you have the authority to bind that organization to these
              Terms. If you do not agree to these Terms, do not use DevControl.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 2 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              2. Description of Service
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              DevControl is an AI-powered AWS infrastructure management platform delivered as a
              software-as-a-service (SaaS) product. It provides cost visibility, resource discovery,
              security compliance monitoring, DORA metrics tracking, and AI-generated recommendations
              for engineering teams. The service is provided on a subscription basis as described on our
              pricing page.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 3 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              3. Account Responsibilities
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              You are responsible for maintaining the confidentiality of your account credentials and
              for all activity that occurs under your account. Do not share your login credentials with
              others. Each account is for use by a single individual or, for team plans, the authorized
              members of your organization.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              You must provide accurate billing information and keep it up to date. DevControl may
              suspend or terminate accounts that provide false or incomplete information.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 4 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              4. Acceptable Use
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              You agree to use DevControl only for lawful purposes and in accordance with these Terms.
              You must not reverse engineer, decompile, or disassemble any part of the DevControl
              platform. You must not use the service to harm, disrupt, or gain unauthorized access to
              third-party systems. You must not share, resell, or sublicense access to DevControl
              without our prior written consent.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              DevControl reserves the right to suspend or terminate accounts that violate these
              acceptable use guidelines, with or without prior notice, depending on the severity of
              the violation.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 5 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              5. Subscription &amp; Billing
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              Paid subscriptions are billed on a recurring monthly or annual basis via Stripe, Inc.
              By subscribing, you authorize DevControl to charge your payment method automatically at
              the start of each billing period.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              You may cancel your subscription at any time from the billing settings page in your
              account. Cancellation takes effect at the end of the current billing period; you will
              retain access to paid features until that date.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              Subscription fees are non-refundable for partial billing periods except at the sole
              discretion of DevControl, Inc. If you believe a charge was made in error, contact us at{' '}
              <a href="mailto:hello@getdevcontrol.com" style={{ color: '#7C3AED', fontWeight: 600 }}>
                hello@getdevcontrol.com
              </a>{' '}
              within 14 days of the charge.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 6 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              6. AWS Credentials
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              To use DevControl, you grant DevControl read-only access to your AWS account via
              credentials you provide. This access is used exclusively to retrieve infrastructure data,
              cost information, and security configuration on your behalf.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              DevControl will never modify, create, or delete your AWS resources without an explicit
              instruction initiated by you within the platform. Your AWS credentials are stored
              encrypted and are never shared with third parties. You may revoke access at any time
              by removing your credentials from the DevControl settings page.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 7 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              7. Intellectual Property
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              DevControl, Inc. owns all rights, title, and interest in and to the DevControl platform,
              including all software, UI, branding, and underlying technology. Nothing in these Terms
              transfers any ownership of DevControl intellectual property to you.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              You retain full ownership of your data, including your AWS infrastructure data, usage
              history, and any content you create within the platform. By using DevControl, you grant
              us a limited license to process and display your data solely for the purpose of providing
              the service.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 8 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              8. Limitation of Liability
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              DevControl is a visibility and analytics tool. We are not responsible for AWS costs you
              incur as a result of actions taken in your AWS account, whether or not those actions were
              informed by DevControl recommendations.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              To the maximum extent permitted by applicable law, DevControl, Inc. shall not be liable
              for any indirect, incidental, special, consequential, or punitive damages, including loss
              of profits or data, arising out of or related to your use of the service, service
              interruptions beyond our reasonable control, or third-party actions. Our total liability
              to you for any claim will not exceed the amount you paid us in the three months preceding
              the claim.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 9 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              9. Termination
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              Either party may terminate these Terms at any time. You may terminate by cancelling your
              subscription and deleting your account. DevControl may terminate or suspend your access
              for violation of these Terms, non-payment, or at our discretion with reasonable notice.
            </p>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              Upon termination, your right to use DevControl ceases immediately. We will delete your
              account data, including AWS credentials, within 30 days of the effective termination date.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 10 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              10. Governing Law
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              These Terms are governed by and construed in accordance with the laws of the State of
              New Jersey, without regard to its conflict of law provisions. Any disputes arising under
              these Terms shall be subject to the exclusive jurisdiction of the state and federal courts
              located in New Jersey.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 11 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              11. Changes to Terms
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              We may update these Terms from time to time. For material changes, we will provide at
              least 30 days notice via email to the address associated with your account before the
              new Terms take effect. Continued use of DevControl after the effective date constitutes
              your acceptance of the updated Terms.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 12 */}
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              12. Contact
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.8 }}>
              Questions about these Terms? Contact DevControl, Inc. at{' '}
              <a href="mailto:hello@getdevcontrol.com" style={{ color: '#7C3AED', fontWeight: 600 }}>
                hello@getdevcontrol.com
              </a>
              .
            </p>
          </div>

        </div>
      </section>

    </div>
  )
}
