import {
  Book, Rocket, FileCode, HelpCircle, ArrowRight, Search,
  Terminal, Cloud, Shield, BarChart3, Layers, GitBranch,
  Bell, Users, Settings, ExternalLink, MessageCircle, FileText, Zap,
} from 'lucide-react';
import Link from 'next/link';

// ============================================
// HERO SECTION
// ============================================
function DocsHero() {
  return (
    <section style={{ background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)', padding: '80px 48px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: 'rgba(124,58,237,0.1)', borderRadius: '20px',
          padding: '4px 14px', marginBottom: '20px',
        }}>
          <Book style={{ width: '14px', height: '14px', color: '#7c3aed' }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
            Documentation
          </span>
        </div>
        <h1 style={{
          color: '#0f172a', fontWeight: 800,
          fontSize: 'clamp(2rem, 4vw, 2.8rem)',
          marginBottom: '16px', letterSpacing: '-0.02em', lineHeight: 1.2,
        }}>
          Everything You Need to Build with DevControl
        </h1>
        <p style={{ color: '#374151', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto 32px', lineHeight: 1.6 }}>
          Guides, tutorials, API references, and best practices — everything to get you started and keep you moving.
        </p>
        <div style={{ position: 'relative', maxWidth: '480px', margin: '0 auto' }}>
          <Search style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', width: '18px', height: '18px', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search documentation..."
            style={{
              width: '100%', height: '48px', paddingLeft: '44px', paddingRight: '16px',
              borderRadius: '10px', border: '1px solid #e5e7eb', background: '#fff',
              fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' as const, color: '#0f172a',
            }}
          />
        </div>
      </div>
    </section>
  );
}

// ============================================
// QUICK START CARDS
// ============================================
function QuickStartSection() {
  const quickStart = [
    { title: 'Getting Started', description: 'Set up DevControl in under 5 minutes with our quickstart guide', icon: Rocket, href: '/docs/getting-started', badge: 'Start here' },
    { title: 'API Reference',   description: 'Complete REST API documentation with examples',               icon: FileCode, href: '/docs/api', badge: null },
    { title: 'Integrations',    description: 'Connect with AWS, GitHub, Slack, and more',                  icon: Zap,      href: '/docs', badge: null },
    { title: 'FAQ',             description: 'Answers to frequently asked questions',                       icon: HelpCircle, href: '/docs', badge: null },
  ];

  return (
    <section style={{ padding: '64px 48px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {quickStart.map((item) => (
            <Link key={item.title} href={item.href} style={{ textDecoration: 'none' }}>
              <div style={{
                height: '100%', border: '1px solid #e5e7eb', borderRadius: '14px',
                padding: '24px', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: 'rgba(124,58,237,0.1)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <item.icon style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
                  </div>
                  {item.badge && (
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 600, color: '#7c3aed',
                      background: '#ede9fe', padding: '2px 8px', borderRadius: '6px',
                    }}>
                      {item.badge}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>{item.title}</span>
                  <ArrowRight style={{ width: '14px', height: '14px', color: '#7c3aed' }} />
                </div>
                <p style={{ fontSize: '0.85rem', color: '#4b5563', lineHeight: 1.5, margin: 0 }}>{item.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// POPULAR TOPICS
// ============================================
function PopularTopicsSection() {
  const topics = [
    { title: 'Connect AWS Account',  href: '/docs/getting-started', icon: Cloud },
    { title: 'Set Up Cost Alerts',   href: '/docs',                  icon: Bell },
    { title: 'Configure RBAC',       href: '/docs',                  icon: Users },
    { title: 'Security Scanning',    href: '/docs',                  icon: Shield },
    { title: 'DORA Metrics Setup',   href: '/app/dora-metrics',      icon: BarChart3 },
    { title: 'Service Catalog',      href: '/services',              icon: Layers },
    { title: 'CI/CD Integration',    href: '/docs',                  icon: GitBranch },
    { title: 'API Authentication',   href: '/docs/api',              icon: FileCode },
  ];

  return (
    <section style={{ background: '#fafafa', padding: '64px 48px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 1.8rem)', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
            Popular Topics
          </h2>
          <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>Most frequently accessed documentation</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', maxWidth: '900px', margin: '0 auto' }}>
          {topics.map((topic) => (
            <Link key={topic.title} href={topic.href} style={{ textDecoration: 'none' }}>
              <div style={{
                border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px 16px',
                background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
              }}>
                <topic.icon style={{ width: '17px', height: '17px', color: '#7c3aed', flexShrink: 0 }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#0f172a' }}>{topic.title}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// DOCUMENTATION CATEGORIES
// ============================================
function CategoriesSection() {
  const categories = [
    {
      title: 'Core Concepts',
      description: 'Understand the fundamentals of DevControl',
      icon: Book,
      links: [
        { title: 'What is DevControl?', href: '/docs' },
        { title: 'Architecture Overview', href: '/docs' },
        { title: 'Key Features', href: '/docs' },
        { title: 'Glossary', href: '/docs' },
      ],
    },
    {
      title: 'AWS Integration',
      description: 'Connect and manage your AWS infrastructure',
      icon: Cloud,
      links: [
        { title: 'IAM Role Setup', href: '/docs' },
        { title: 'Resource Discovery', href: '/docs' },
        { title: 'Multi-Account Setup', href: '/docs' },
        { title: 'Supported Services', href: '/docs' },
      ],
    },
    {
      title: 'Security & Compliance',
      description: 'Configure security scanning and compliance',
      icon: Shield,
      links: [
        { title: 'Security Checks', href: '/docs' },
        { title: 'Compliance Frameworks', href: '/docs' },
        { title: 'Custom Policies', href: '/docs' },
        { title: 'Remediation Guides', href: '/docs' },
      ],
    },
    {
      title: 'Cost Management',
      description: 'Optimize and track cloud spending',
      icon: BarChart3,
      links: [
        { title: 'Cost Analysis', href: '/docs' },
        { title: 'Budget Alerts', href: '/docs' },
        { title: 'Rightsizing', href: '/docs' },
        { title: 'Reserved Instances', href: '/docs' },
      ],
    },
    {
      title: 'Platform Engineering',
      description: 'Build your internal developer platform',
      icon: Layers,
      links: [
        { title: 'Service Catalog', href: '/docs' },
        { title: 'Golden Paths', href: '/docs' },
        { title: 'Self-Service Workflows', href: '/docs' },
        { title: 'DORA Metrics', href: '/docs' },
      ],
    },
    {
      title: 'Administration',
      description: 'Manage users, teams, and settings',
      icon: Settings,
      links: [
        { title: 'User Management', href: '/docs' },
        { title: 'Team Setup', href: '/docs' },
        { title: 'SSO Configuration', href: '/docs' },
        { title: 'Audit Logs', href: '/audit-logs' },
      ],
    },
  ];

  return (
    <section style={{ padding: '64px 48px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 1.8rem)', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
            Documentation by Category
          </h2>
          <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>Browse documentation organized by topic</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {categories.map((category) => (
            <div
              key={category.title}
              style={{
                border: '1px solid #e5e7eb', borderRadius: '14px', padding: '24px',
                background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  background: 'rgba(124,58,237,0.1)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <category.icon style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
                </div>
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>{category.title}</div>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{category.description}</div>
                </div>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {category.links.map((link) => (
                  <li key={link.title}>
                    <Link href={link.href} style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      fontSize: '0.875rem', color: '#4b5563', textDecoration: 'none',
                    }}>
                      <ArrowRight style={{ width: '12px', height: '12px', color: '#7c3aed', flexShrink: 0 }} />
                      {link.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// CODE EXAMPLES
// ============================================
function CodeExamplesSection() {
  const codeBlocks = [
    {
      title: 'CLI Quick Start',
      icon: Terminal,
      code: `# Install CLI\nnpm install -g @devcontrol/cli\n\n# Authenticate\ndevcontrol login\n\n# Discover resources\ndevcontrol discover --aws`,
    },
    {
      title: 'API Request',
      icon: FileCode,
      code: `curl -X GET \\\n  https://api.getdevcontrol.com/v1/services \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -H "Content-Type: application/json"`,
    },
    {
      title: 'AWS IAM Policy',
      icon: Cloud,
      code: `{\n  "Version": "2012-10-17",\n  "Statement": [{\n    "Effect": "Allow",\n    "Action": ["ec2:Describe*"],\n    "Resource": "*"\n  }]\n}`,
    },
    {
      title: 'GitHub Action',
      icon: GitBranch,
      code: `- name: Record Deployment\n  uses: devcontrol/deploy-action@v1\n  with:\n    api-key: \${{ secrets.DEVCONTROL_KEY }}\n    service: my-service`,
    },
  ];

  return (
    <section style={{ background: '#fafafa', padding: '64px 48px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 1.8rem)', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
            Quick Reference
          </h2>
          <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>Common commands and code snippets</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', maxWidth: '900px', margin: '0 auto' }}>
          {codeBlocks.map((block) => (
            <div
              key={block.title}
              style={{
                border: '1px solid #e5e7eb', borderRadius: '14px', overflow: 'hidden',
                background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}
            >
              <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <block.icon style={{ width: '15px', height: '15px', color: '#7c3aed' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{block.title}</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <pre style={{
                  background: '#f8fafc', padding: '14px 16px', borderRadius: '8px',
                  overflow: 'auto', margin: 0,
                }}>
                  <code style={{ fontSize: '0.78rem', color: '#4b5563', fontFamily: 'monospace', whiteSpace: 'pre' }}>
                    {block.code}
                  </code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// RESOURCES SECTION
// ============================================
function ResourcesSection() {
  const resources = [
    { title: 'Community Slack', description: 'Join 500+ DevControl users', icon: MessageCircle, href: '#',          external: true },
    { title: 'Changelog',       description: "See what's new in DevControl", icon: FileText,    href: '/changelog', external: false },
    { title: 'Status Page',     description: 'Check system status',           icon: BarChart3,   href: '#',          external: true },
    { title: 'Contact Support', description: 'Get help from our team',        icon: HelpCircle,  href: '/contact',   external: false },
  ];

  return (
    <section style={{ padding: '64px 48px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 1.8rem)', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
            Additional Resources
          </h2>
          <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>More ways to get help and stay updated</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', maxWidth: '900px', margin: '0 auto' }}>
          {resources.map((resource) => (
            <Link
              key={resource.title}
              href={resource.href}
              target={resource.external ? '_blank' : undefined}
              style={{ textDecoration: 'none' }}
            >
              <div style={{
                border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px 16px',
                background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                textAlign: 'center', cursor: 'pointer',
              }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  background: 'rgba(124,58,237,0.1)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
                }}>
                  <resource.icon style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '4px' }}>
                  {resource.title}
                  {resource.external && <ExternalLink style={{ width: '11px', height: '11px', color: '#9ca3af' }} />}
                </div>
                <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: 0 }}>{resource.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// CTA SECTION
// ============================================
function CTASection() {
  return (
    <section style={{ background: '#fafafa', padding: '64px 48px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 1.8rem)', fontWeight: 700, color: '#0f172a', marginBottom: '12px' }}>
          Can&apos;t Find What You&apos;re Looking For?
        </h2>
        <p style={{ color: '#4b5563', maxWidth: '480px', margin: '0 auto 28px', lineHeight: 1.6, fontSize: '0.95rem' }}>
          Our team is here to help. Reach out and we&apos;ll get you pointed in the right direction.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <Link href="/contact" style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '10px 24px', borderRadius: '8px',
            background: '#7c3aed', color: '#fff', fontWeight: 600,
            fontSize: '0.9rem', textDecoration: 'none',
          }}>
            Contact Support
          </Link>
          <a href="mailto:support@getdevcontrol.com" style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '10px 24px', borderRadius: '8px',
            border: '1px solid #e5e7eb', background: '#fff',
            color: '#374151', fontWeight: 500,
            fontSize: '0.9rem', textDecoration: 'none',
          }}>
            Email Us
          </a>
        </div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================
export default function DocsPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <DocsHero />
      <QuickStartSection />
      <PopularTopicsSection />
      <CategoriesSection />
      <CodeExamplesSection />
      <ResourcesSection />
      <CTASection />
    </div>
  );
}
