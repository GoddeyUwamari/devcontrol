'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronDown, Menu, X,
  Server, TrendingDown, Shield, BarChart2, Search, Activity,
  Rocket, TrendingUp, Building2, GitBranch, Layers, DollarSign,
  BookOpen, Code2, FileText, Clock, Users,
} from 'lucide-react'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

const platformItems = [
  { icon: Server,       title: 'Infrastructure Management', desc: 'Unified view of all your cloud resources',    href: '/platform/infrastructure' },
  { icon: TrendingDown, title: 'Cost Optimization',         desc: 'Cut cloud spend with AI recommendations',    href: '/platform/costs' },
  { icon: Shield,       title: 'Security & Compliance',     desc: 'Automated security posture management',      href: '/solutions/security' },
  { icon: BarChart2,    title: 'DORA Metrics',              desc: 'Track elite engineering performance',        href: '/dora-metrics' },
  { icon: Search,       title: 'Resource Discovery',        desc: 'Find and tag every cloud asset',             href: '/aws-resources' },
  { icon: Activity,     title: 'Service Health',            desc: 'Real-time uptime and incident tracking',     href: '/platform/service-health' },
]

const solutionsItems = [
  { icon: Rocket,     title: 'For Startups',           desc: 'Move fast without breaking things',       href: '/solutions/startups' },
  { icon: TrendingUp, title: 'For Scale-ups',          desc: 'Scale infrastructure confidently',        href: '/solutions/scaleups' },
  { icon: Building2,  title: 'For Mid-Market', desc: 'Built for growing teams of 20–100 engineers', href: '/solutions/mid-market' },
  { icon: GitBranch,  title: 'For DevOps Teams',       desc: 'Automate your entire delivery pipeline',  href: '/solutions/devops' },
  { icon: Layers,     title: 'For Platform Engineers', desc: 'Build and manage internal platforms',     href: '/solutions/platform-engineers' },
  { icon: DollarSign, title: 'For FinOps Teams',       desc: 'Optimize cloud costs across teams',       href: '/solutions/finops' },
]

const resourcesItems = [
  { icon: BookOpen,  title: 'Documentation', desc: 'Guides, references, and tutorials',       href: '/docs' },
  { icon: Code2,     title: 'API Reference', desc: 'Complete REST and GraphQL docs',          href: '/docs/api' },
  { icon: FileText,  title: 'Blog',          desc: 'Engineering insights and best practices', href: '/blog' },
  { icon: BarChart2, title: 'Case Studies',  desc: 'See how teams use DevControl',            href: '/case-studies' },
  { icon: Clock,     title: 'Changelog',     desc: 'Latest features and improvements',        href: '/changelog' },
  { icon: Users,     title: 'Community',     desc: 'Connect with other DevControl users',     href: '/community' },
]

type NavItem = { icon: React.ElementType; title: string; desc: string; href: string | null }
type DropdownKey = 'platform' | 'solutions' | 'resources'


function MegaMenu({ items, showFooter, onClose, align = 'left' }: { items: NavItem[]; showFooter?: boolean; onClose?: () => void; align?: 'left' | 'right' }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        left: align === 'right' ? 'auto' : '-24px',
        right: align === 'right' ? '-24px' : 'auto',
        backgroundColor: '#fff',
        borderRadius: '16px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
        border: '1px solid #e5e7eb',
        padding: '16px',
        minWidth: 'min(560px, calc(100vw - 48px))',
        maxWidth: 'calc(100vw - 48px)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '4px',
        zIndex: 100,
        animation: 'megaFadeIn 0.15s ease',
      }}
    >
      {items.map((item) => (
        <MegaMenuItem key={item.title} item={item} onClose={onClose} />
      ))}

      {showFooter && (
        <div
          style={{
            gridColumn: '1 / -1',
            borderTop: '1px solid #f3f4f6',
            marginTop: '8px',
            paddingTop: '12px',
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          <Link
            href="/register"
            onClick={onClose}
            style={{ fontSize: '0.82rem', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.02em', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
          >
            Get started free →
          </Link>
          <Link
            href="/tour"
            onClick={onClose}
            style={{ fontSize: '0.82rem', fontWeight: 500, color: '#374151', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#0f172a')}
            onMouseLeave={e => (e.currentTarget.style.color = '#374151')}
          >
            Watch a demo
          </Link>
        </div>
      )}
    </div>
  )
}

function MegaMenuItem({ item, onClose }: { item: NavItem; onClose?: () => void }) {
  const { icon: Icon, title, desc, href } = item

  const content = (
    <>
      <div
        style={{
          backgroundColor: 'rgba(124,58,237,0.08)',
          borderRadius: '10px',
          padding: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: '2px',
        }}
      >
        <Icon style={{ width: '16px', height: '16px', color: '#7c3aed' }} />
      </div>
      <div style={{ minWidth: 0, wordBreak: 'break-word' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', marginBottom: '3px', display: 'block', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
            {title}
          </span>
          {!href && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#7c3aed', background: '#ede9fe', padding: '1px 6px', borderRadius: '4px', letterSpacing: '0.05em' }}>
              SOON
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.78rem', fontWeight: 400, color: '#374151', lineHeight: 1.45 }}>{desc}</div>
      </div>
    </>
  )

  const sharedStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '14px',
    padding: '14px 16px',
    borderRadius: '10px',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background 0.15s ease',
    background: 'transparent',
    border: 'none',
    textAlign: 'left' as const,
    width: '100%',
    minWidth: 0,
  }

  return (
    <Link
      href={href ?? '#'}
      onClick={onClose}
      style={sharedStyle}
      onMouseEnter={e => (e.currentTarget.style.background = '#faf5ff')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {content}
    </Link>
  )
}

function NavTrigger({
  label,
  dropdownKey,
  activeDropdown,
  onOpen,
  onClose,
  children,
}: {
  label: string
  dropdownKey: DropdownKey
  activeDropdown: DropdownKey | null
  onOpen: (key: DropdownKey) => void
  onClose: () => void
  children: React.ReactNode
}) {
  const isOpen = activeDropdown === dropdownKey
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => onOpen(dropdownKey)}
      onMouseLeave={onClose}
    >
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '6px 12px',
          fontSize: '0.9rem',
          fontWeight: isOpen ? 600 : 500,
          color: isOpen ? '#7c3aed' : '#0f172a',
          letterSpacing: '-0.01em',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '8px',
          transition: 'color 0.15s ease',
        }}
      >
        {label}
        <ChevronDown
          style={{
            width: '14px',
            height: '14px',
            transition: 'transform 0.2s ease',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>
      {isOpen && children}
    </div>
  )
}

export function MarketingNav() {
  const [activeDropdown, setActiveDropdown] = useState<DropdownKey | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTiny = width > 0 && width < 380

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section)
  }

  const pathname = usePathname()
  useEffect(() => {
    setMobileMenuOpen(false)
    setExpandedSection(null)
  }, [pathname])

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
        @keyframes megaFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Announcement Bar */}
      <div
        style={{
          width: '100%',
          padding: isMobile ? '8px 12px' : '10px 0',
          textAlign: 'center',
          background: 'linear-gradient(to right, #7c3aed, #6d28d9)',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 51,
          overflow: 'hidden',
        }}
      >
        <p style={{ color: '#ffffff', fontSize: isMobile ? '0.75rem' : '0.875rem', fontWeight: 500, letterSpacing: '0.01em', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ marginRight: '8px' }}>🚀</span>
          NEW: 8 AI-Powered Features Now Available!{' '}
          <a
            href="/platform/infrastructure"
            style={{ color: '#ffffff', fontSize: isMobile ? '0.75rem' : '0.875rem', fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: '2px', marginLeft: '4px' }}
          >
            Learn More →
          </a>
        </p>
      </div>

      {/* Navbar */}
      <nav
        style={{
          position: 'fixed',
          top: '40px',
          left: 0,
          right: 0,
          zIndex: 50,
          backgroundColor: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #f3f4f6',
          height: '64px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '1400px',
            margin: '0 auto',
            padding: isMobile ? '0 16px' : width < 1024 ? '0 24px' : '0 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
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
              {!isTiny && <span style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>DevControl</span>}
            </Link>

            {/* Desktop Nav */}
            <div className="hidden lg:flex" style={{ alignItems: 'center', gap: '4px' }}>
              <NavTrigger label="Platform" dropdownKey="platform" activeDropdown={activeDropdown} onOpen={openDropdown} onClose={closeDropdown}>
                <MegaMenu items={platformItems} showFooter onClose={closeDropdown} />
              </NavTrigger>

              <NavTrigger label="Solutions" dropdownKey="solutions" activeDropdown={activeDropdown} onOpen={openDropdown} onClose={closeDropdown}>
                <MegaMenu items={solutionsItems} showFooter onClose={closeDropdown} />
              </NavTrigger>

              <NavTrigger label="Resources" dropdownKey="resources" activeDropdown={activeDropdown} onOpen={openDropdown} onClose={closeDropdown}>
                <MegaMenu items={resourcesItems} onClose={closeDropdown} align="right" />
              </NavTrigger>

              <NavLink href="/pricing">Pricing</NavLink>
              <NavLink href="/solutions/enterprise">Enterprise</NavLink>
              <NavLink href="/docs">Developers</NavLink>
            </div>
          </div>

          {/* Right: CTAs */}
          <div className="hidden md:flex" style={{ alignItems: 'center', gap: '8px' }}>
            <Link
              href="/login"
              style={{
                color: '#0f172a',
                fontWeight: 500,
                fontSize: '0.9rem',
                padding: '8px 16px',
                textDecoration: 'none',
                borderRadius: '8px',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#7c3aed')}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#0f172a')}
            >
              Sign In
            </Link>
            <Link href="/contact" style={{
              padding: '8px 18px', borderRadius: '8px',
              border: '1.5px solid #7c3aed', color: '#7c3aed',
              fontWeight: 600, fontSize: '0.875rem', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center',
            }}>
              Contact Sales
            </Link>
            <Link
              href="/register"
              style={{
                backgroundColor: '#7c3aed',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.875rem',
                letterSpacing: '-0.01em',
                padding: '10px 20px',
                borderRadius: '8px',
                textDecoration: 'none',
                transition: 'opacity 0.15s ease, transform 0.15s ease',
                display: 'inline-block',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLAnchorElement
                el.style.opacity = '0.9'
                el.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLAnchorElement
                el.style.opacity = '1'
                el.style.transform = 'translateY(0)'
              }}
            >
              Get Started Free
            </Link>
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
            style={{
              position: 'absolute',
              top: '64px',
              left: 0,
              right: 0,
              backgroundColor: '#fff',
              borderTop: '1px solid #f3f4f6',
              borderBottom: '1px solid #f3f4f6',
              paddingBottom: '16px',
              animation: 'megaFadeIn 0.2s ease',
              zIndex: 99,
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            className="lg:hidden"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '8px' }}>

              {/* Platform expandable */}
              <button
                onClick={() => toggleSection('platform')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', fontSize: '15px', fontWeight: 500, color: '#0f172a', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                Platform
                <ChevronDown style={{ width: '16px', height: '16px', transition: 'transform 0.2s ease', transform: expandedSection === 'platform' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>
              {expandedSection === 'platform' && (
                <div style={{ backgroundColor: '#faf5ff', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                  {platformItems.map(item => (
                    <Link key={item.title} href={item.href ?? '#'} onClick={() => setMobileMenuOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 32px', fontSize: '14px', color: '#374151', textDecoration: 'none' }}>
                      <item.icon style={{ width: '14px', height: '14px', color: '#7c3aed', flexShrink: 0 }} />
                      {item.title}
                    </Link>
                  ))}
                </div>
              )}

              {/* Solutions expandable */}
              <button
                onClick={() => toggleSection('solutions')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', fontSize: '15px', fontWeight: 500, color: '#0f172a', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                Solutions
                <ChevronDown style={{ width: '16px', height: '16px', transition: 'transform 0.2s ease', transform: expandedSection === 'solutions' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>
              {expandedSection === 'solutions' && (
                <div style={{ backgroundColor: '#faf5ff', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                  {solutionsItems.map(item => (
                    <Link key={item.title} href={item.href ?? '#'} onClick={() => setMobileMenuOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 32px', fontSize: '14px', color: '#374151', textDecoration: 'none' }}>
                      <item.icon style={{ width: '14px', height: '14px', color: '#7c3aed', flexShrink: 0 }} />
                      {item.title}
                    </Link>
                  ))}
                </div>
              )}

              {/* Resources expandable */}
              <button
                onClick={() => toggleSection('resources')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', fontSize: '15px', fontWeight: 500, color: '#0f172a', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                Resources
                <ChevronDown style={{ width: '16px', height: '16px', transition: 'transform 0.2s ease', transform: expandedSection === 'resources' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>
              {expandedSection === 'resources' && (
                <div style={{ backgroundColor: '#faf5ff', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                  {resourcesItems.map(item => (
                    <Link key={item.title} href={item.href ?? '#'} onClick={() => setMobileMenuOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 32px', fontSize: '14px', color: '#374151', textDecoration: 'none' }}>
                      <item.icon style={{ width: '14px', height: '14px', color: '#7c3aed', flexShrink: 0 }} />
                      {item.title}
                    </Link>
                  ))}
                </div>
              )}

              <Link href="/pricing" style={{ display: 'block', padding: '10px 24px', fontSize: '15px', fontWeight: 500, color: '#0f172a', textDecoration: 'none' }}>
                Pricing
              </Link>
              <Link href="/solutions/enterprise" style={{ display: 'block', padding: '10px 24px', fontSize: '15px', fontWeight: 500, color: '#0f172a', textDecoration: 'none' }}>
                Enterprise
              </Link>
              <Link href="/docs" style={{ display: 'block', padding: '10px 24px', fontSize: '15px', fontWeight: 500, color: '#0f172a', textDecoration: 'none' }}>
                Developers
              </Link>

              <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 24px' }}>
                <Link
                  href="/login"
                  style={{ display: 'block', textAlign: 'center', padding: '10px 0', fontSize: '15px', fontWeight: 500, color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px', textDecoration: 'none' }}
                >
                  Sign In
                </Link>
                <Link
                  href="/contact"
                  style={{ display: 'block', textAlign: 'center', padding: '10px 0', fontSize: '15px', fontWeight: 600, color: '#7c3aed', border: '1.5px solid #7c3aed', borderRadius: '8px', textDecoration: 'none' }}
                >
                  Contact Sales
                </Link>
                <Link
                  href="/register"
                  style={{ display: 'block', textAlign: 'center', padding: '10px 0', fontSize: '15px', fontWeight: 600, color: '#fff', backgroundColor: '#7c3aed', borderRadius: '8px', textDecoration: 'none' }}
                >
                  Get Started Free
                </Link>
              </div>
            </div>
          </div>
        )}
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
        fontSize: '0.9rem',
        fontWeight: 500,
        letterSpacing: '-0.01em',
        color: hovered ? '#7c3aed' : '#0f172a',
        textDecoration: 'none',
        borderRadius: '8px',
        transition: 'color 0.15s ease',
      }}
    >
      {children}
    </Link>
  )
}
