export default function CookiePolicyPage() {
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
            Cookie Policy
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

          <p style={{ fontSize: '16px', color: '#1f2937', lineHeight: 1.8, marginBottom: '40px' }}>
            This Cookie Policy explains how DevControl, Inc. (&quot;DevControl,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
            uses cookies and similar technologies on the DevControl platform. This policy should be
            read alongside our{' '}
            <a href="/legal/privacy" style={{ color: '#7C3AED', fontWeight: 600 }}>
              Privacy Policy
            </a>
            .
          </p>

          {/* Section 1 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              1. What Are Cookies
            </h2>
            <p style={{ fontSize: '16px', color: '#1f2937', lineHeight: 1.8 }}>
              Cookies are small text files that a website places on your device when you visit. They
              allow the site to remember information about your visit, such as whether you are logged
              in, your display preferences, and how you use the application. Cookies are widely used to
              make websites work efficiently and to provide useful features to users.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 2 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              2. Cookies We Use
            </h2>
            <p style={{ fontSize: '16px', color: '#1f2937', lineHeight: 1.8, marginBottom: '20px' }}>
              DevControl uses three categories of cookies. We do not use advertising cookies and we do
              not sell or share cookie data with advertisers.
            </p>

            <div style={{
              background: '#F9FAFB', borderRadius: '12px',
              border: '1px solid #E2E8F0', padding: '24px',
              marginBottom: '16px',
            }}>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                Session Cookies
              </p>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: 1.75, margin: 0 }}>
                These cookies are essential to the operation of DevControl. They maintain your
                authenticated session so you do not need to log in on every page load. Session cookies
                are temporary and expire when you close your browser or after a period of inactivity.
                The platform cannot function correctly without them.
              </p>
            </div>

            <div style={{
              background: '#F9FAFB', borderRadius: '12px',
              border: '1px solid #E2E8F0', padding: '24px',
              marginBottom: '16px',
            }}>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                Preference Cookies
              </p>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: 1.75, margin: 0 }}>
                These cookies remember your display preferences, such as your selected theme (light or
                dark mode) and timezone setting. They make your experience more consistent across
                sessions. Disabling preference cookies will reset your display settings each time you
                visit.
              </p>
            </div>

            <div style={{
              background: '#F9FAFB', borderRadius: '12px',
              border: '1px solid #E2E8F0', padding: '24px',
            }}>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                Analytics Cookies
              </p>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: 1.75, margin: 0 }}>
                These cookies help us understand how users interact with the DevControl platform. We
                use this data in aggregate to identify which features are most used, where users
                encounter difficulty, and how to improve the product. Analytics data is not linked to
                your personal identity.
              </p>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 3 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              3. Third-Party Cookies
            </h2>
            <p style={{ fontSize: '16px', color: '#1f2937', lineHeight: 1.8 }}>
              Stripe, Inc. sets cookies when you interact with the billing and payment sections of
              DevControl. These cookies are used by Stripe to prevent fraud, verify payment security,
              and maintain the integrity of your payment session. Stripe operates these cookies under
              its own privacy and cookie policies, which we encourage you to review.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 4 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              4. Managing Cookies
            </h2>
            <p style={{ fontSize: '16px', color: '#1f2937', lineHeight: 1.8, marginBottom: '12px' }}>
              You can control and delete cookies through your browser settings. Most browsers allow
              you to view, block, or delete cookies from specific sites. To find the correct
              instructions for your browser, search for &quot;manage cookies&quot; in your browser&apos;s help
              documentation.
            </p>
            <p style={{ fontSize: '16px', color: '#1f2937', lineHeight: 1.8 }}>
              Please note that blocking or deleting session cookies will prevent you from staying
              logged in to DevControl. Core platform features require session cookies to work, and
              disabling them will break authentication. Preference and analytics cookies can be
              disabled without affecting your ability to use the platform.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 5 */}
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              5. Contact
            </h2>
            <p style={{ fontSize: '16px', color: '#1f2937', lineHeight: 1.8 }}>
              If you have questions about how DevControl uses cookies, contact DevControl, Inc. at{' '}
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
