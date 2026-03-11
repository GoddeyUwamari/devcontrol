'use client'

import Link from 'next/link'
import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronDown, Menu, X,
  Server, TrendingDown, Shield, BarChart2, Search, Activity,
  Rocket, TrendingUp, Building2, GitBranch, Layers, DollarSign,
  BookOpen, Code2, FileText, Clock, Users,
} from 'lucide-react'

// href: null means the page doesn't exist yet → shows "Coming Soon" alert
const platformItems = [
  { icon: Server,       title: 'Infrastructure Management', desc: 'Unified view of all your cloud resources', href: '/platform/infrastructure' },
  { icon: TrendingDown, title: 'Cost Optimization',         desc: 'Cut cloud spend with AI recommendations',  href: '/platform/costs' },
  { icon: Shield,       title: 'Security & Compliance',     desc: 'Automated security posture management',    href: '/solutions/security' },
  { icon: BarChart2,    title: 'DORA Metrics',              desc: 'Track elite engineering performance',      href: '/dora-metrics' },
  { icon: Search,       title: 'Resource Discovery',        desc: 'Find and tag every cloud asset',           href: '/aws-resources' },
  { icon: Activity,     title: 'Service Health',            desc: 'Real-time uptime and incident tracking',   href: '/services' },
]

const solutionsItems = [
  { icon: Rocket,     title: 'For Startups',           desc: 'Move fast without breaking things',        href: '/solutions/startups' },
  { icon: TrendingUp, title: 'For Scale-ups',          desc: 'Scale infrastructure confidently',         href: '/solutions/scaleups' },
  { icon: Building2,  title: 'For Enterprise',         desc: 'Enterprise-grade controls and compliance',  href: '/solutions/enterprise' },
  { icon: GitBranch,  title: 'For DevOps Teams',       desc: 'Automate your entire delivery pipeline',   href: '/solutions/devops' },
  { icon: Layers,     title: 'For Platform Engineers', desc: 'Build and manage internal platforms',      href: '/solutions/platform-engineers' },
  { icon: DollarSign, title: 'For FinOps Teams',       desc: 'Optimize cloud costs across teams',        href: '/solutions/finops' },
]

const resourcesItems = [
  { icon: BookOpen, title: 'Documentation', desc: 'Guides, references, and tutorials',       href: '/docs' },
  { icon: Code2,    title: 'API Reference', desc: 'Complete REST & GraphQL docs',            href: '/docs/api' },
  { icon: FileText, title: 'Blog',          desc: 'Engineering insights and best practices', href: '/blog' },
  { icon: BarChart2,title: 'Case Studies',  desc: 'See how teams use DevControl',            href: null },
  { icon: Clock,    title: 'Changelog',     desc: 'Latest features and improvements',        href: '/changelog' },
  { icon: Users,    title: 'Community',     desc: 'Connect with other DevControl users',     href: null },
]

type NavItem = { icon: React.ElementType; title: string; desc: string; href: string | null }
type DropdownKey = 'platform' | 'solutions' | 'resources'

const handleComingSoon = (e: React.MouseEvent, pageName: string) => {
  e.preventDefault()
  alert(`${pageName} page coming soon!`)
}

function DropdownMenu({ items }: { items: NavItem[] }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '320px',
        background: '#fff',
        borderRadius: '16px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        border: '1px solid #f3f4f6',
        padding: '8px',
        zIndex: 100,
        animation: 'fadeInDown 0.18s ease',
      }}
    >
      {items.map((item) => (
        <DropdownItem key={item.title} item={item} />
      ))}
    </div>
  )
}

function DropdownItem({ item }: { item: NavItem }) {
  const [hovered, setHovered] = useState(false)
  const { icon: Icon, title, desc, href } = item

  const content = (
    <>
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '8px',
          background: hovered ? '#ede9fe' : '#f5f3ff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.15s ease',
        }}
      >
        <Icon style={{ width: '16px', height: '16px', color: '#7c3aed' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: hovered ? '#7c3aed' : '#111827', lineHeight: 1.3, transition: 'color 0.15s ease' }}>
            {title}
          </span>
          {!href && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#7c3aed', background: '#ede9fe', padding: '1px 6px', borderRadius: '4px', letterSpacing: '0.05em' }}>
              SOON
            </span>
          )}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px', lineHeight: 1.4 }}>
          {desc}
        </div>
      </div>
    </>
  )

  const sharedStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '10px',
    cursor: 'pointer',
    background: hovered ? '#f5f3ff' : 'transparent',
    transition: 'background 0.15s ease',
    textDecoration: 'none',
    width: '100%',
    border: 'none',
    textAlign: 'left' as const,
  }

  if (href) {
    return (
      <Link
        href={href}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={sharedStyle}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => handleComingSoon(e, title)}
      style={sharedStyle}
    >
      {content}
    </button>
  )
}

export function MarketingNav() {
  const [activeDropdown, setActiveDropdown] = useState<DropdownKey | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openDropdown = (key: DropdownKey) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setActiveDropdown(key)
  }

  const closeDropdown = () => {
    timeoutRef.current = setTimeout(() => setActiveDropdown(null), 120)
  }

  return (
    <>
      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      {/* Announcement Bar */}
      <div
        style={{
          width: '100%',
          padding: '10px 0',
          textAlign: 'center',
          background: 'linear-gradient(to right, #7c3aed, #6d28d9)',
          position: 'relative',
          zIndex: 51,
        }}
      >
        <p style={{ color: '#fff', fontSize: '14px', fontWeight: 500, margin: 0 }}>
          <span style={{ marginRight: '8px' }}>🚀</span>
          NEW: 8 AI-Powered Features Now Available!{' '}
          <a
            href="#ai-features"
            style={{ color: '#e9d5ff', textDecoration: 'underline', marginLeft: '4px' }}
          >
            Learn More →
          </a>
        </p>
      </div>

      {/* Navbar */}
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          width: '100%',
          borderBottom: '1px solid #f3f4f6',
          backgroundColor: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', height: '64px', alignItems: 'center', justifyContent: 'space-between' }}>

            {/* Left: Logo + Nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
              {/* Logo */}
              <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
                <div
                  style={{
                    display: 'flex',
                    width: '40px',
                    height: '40px',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                  }}
                >
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>DC</span>
                </div>
                <span style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>DevControl</span>
              </Link>

              {/* Desktop Nav */}
              <div className="hidden lg:flex" style={{ alignItems: 'center', gap: '4px' }}>

                {/* Platform */}
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => openDropdown('platform')}
                  onMouseLeave={closeDropdown}
                >
                  <button
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: activeDropdown === 'platform' ? '#7c3aed' : '#374151',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    Platform
                    <ChevronDown
                      style={{
                        width: '14px',
                        height: '14px',
                        transition: 'transform 0.2s ease',
                        transform: activeDropdown === 'platform' ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                  {activeDropdown === 'platform' && <DropdownMenu items={platformItems} />}
                </div>

                {/* Solutions */}
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => openDropdown('solutions')}
                  onMouseLeave={closeDropdown}
                >
                  <button
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: activeDropdown === 'solutions' ? '#7c3aed' : '#374151',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    Solutions
                    <ChevronDown
                      style={{
                        width: '14px',
                        height: '14px',
                        transition: 'transform 0.2s ease',
                        transform: activeDropdown === 'solutions' ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                  {activeDropdown === 'solutions' && <DropdownMenu items={solutionsItems} />}
                </div>

                {/* Resources */}
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => openDropdown('resources')}
                  onMouseLeave={closeDropdown}
                >
                  <button
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: activeDropdown === 'resources' ? '#7c3aed' : '#374151',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    Resources
                    <ChevronDown
                      style={{
                        width: '14px',
                        height: '14px',
                        transition: 'transform 0.2s ease',
                        transform: activeDropdown === 'resources' ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                  {activeDropdown === 'resources' && <DropdownMenu items={resourcesItems} />}
                </div>

                {/* Standalone links */}
                <NavLink href="/pricing">Pricing</NavLink>
                <NavLink href="/solutions/enterprise">Enterprise</NavLink>
                <NavLink href="/developers">Developers</NavLink>
              </div>
            </div>

            {/* Right: CTAs */}
            <div className="hidden md:flex" style={{ alignItems: 'center', gap: '16px' }}>
              <Link
                href="/login"
                style={{ fontSize: '14px', fontWeight: 500, color: '#374151', textDecoration: 'none' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#111827')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = '#374151')}
              >
                Sign In
              </Link>
              <Button
                asChild
                style={{ backgroundColor: '#7c3aed' }}
                className="hover:opacity-90 text-white font-semibold shadow-md hover:shadow-lg transition-all"
              >
                <Link href="/register">Get Started Free</Link>
              </Button>
            </div>

            {/* Mobile toggle */}
            <button
              className="lg:hidden"
              style={{ padding: '8px', color: '#374151', background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X style={{ width: '24px', height: '24px' }} /> : <Menu style={{ width: '24px', height: '24px' }} />}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div
              style={{ borderTop: '1px solid #f3f4f6', paddingBottom: '16px', animation: 'fadeInDown 0.2s ease' }}
              className="lg:hidden"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '8px' }}>
                {/* Platform — no live page yet */}
                <button
                  onClick={(e) => handleComingSoon(e, 'Platform')}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', fontSize: '15px', fontWeight: 500, color: '#374151', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Platform
                </button>
                {/* Solutions — point to startups as the first live page */}
                <Link href="/solutions/startups" style={{ display: 'block', padding: '10px 16px', fontSize: '15px', fontWeight: 500, color: '#374151', textDecoration: 'none' }}>
                  Solutions
                </Link>
                <Link href="/docs" style={{ display: 'block', padding: '10px 16px', fontSize: '15px', fontWeight: 500, color: '#374151', textDecoration: 'none' }}>
                  Resources
                </Link>
                <Link href="/pricing" style={{ display: 'block', padding: '10px 16px', fontSize: '15px', fontWeight: 500, color: '#374151', textDecoration: 'none' }}>
                  Pricing
                </Link>
                <Link href="/solutions/enterprise" style={{ display: 'block', padding: '10px 16px', fontSize: '15px', fontWeight: 500, color: '#374151', textDecoration: 'none' }}>
                  Enterprise
                </Link>
                <Link href="/developers" style={{ display: 'block', padding: '10px 16px', fontSize: '15px', fontWeight: 500, color: '#374151', textDecoration: 'none' }}>
                  Developers
                </Link>
                <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
                  <Link
                    href="/login"
                    style={{ display: 'block', textAlign: 'center', padding: '8px 0', fontSize: '15px', fontWeight: 500, color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px', textDecoration: 'none' }}
                  >
                    Sign In
                  </Link>
                  <Button
                    asChild
                    style={{ backgroundColor: '#7c3aed', width: '100%' }}
                    className="hover:opacity-90 text-white font-semibold"
                  >
                    <Link href="/register">Get Started Free</Link>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>
    </>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 12px',
        fontSize: '14px',
        fontWeight: 500,
        color: hovered ? '#7c3aed' : '#374151',
        textDecoration: 'none',
        borderRadius: '8px',
        transition: 'color 0.15s ease',
      }}
    >
      {children}
    </Link>
  )
}
