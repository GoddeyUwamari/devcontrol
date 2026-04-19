'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Layers, Server, DollarSign, Shield, GitBranch,
  Plus, Rocket, Activity, Lightbulb, Building, TrendingDown,
  BarChart3, FileText, Sparkles, AlertTriangle, CheckSquare,
  ClipboardList, Users, Building2, Code, ChevronDown, BellDot,
  Search, Menu, X, Bell, Clock, Target, SlidersHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { UserDropdown } from '@/components/ui/user-dropdown';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/contexts/auth-context';
import { quickActions } from '@/lib/navigation-config';
import { useState, useEffect } from 'react';

type NavChild = {
  label: string;
  href: string;
  icon: React.ElementType;
  desc: string;
};

type NavItem =
  | { label: string; href: string; icon: React.ElementType; children?: undefined }
  | { label: string; icon: React.ElementType; children: NavChild[]; href?: undefined };

const navItems: NavItem[] = [
  {
    label: 'Services',
    icon: Layers,
    children: [
      { label: 'Services Overview', href: '/services', icon: Layers, desc: 'All services and health status' },
      { label: 'Add Service', href: '/services/new', icon: Plus, desc: 'Register a new service' },
      { label: 'Deployments', href: '/deployments', icon: Rocket, desc: 'Deployment history and tracking' },
      { label: 'Dependencies', href: '/dependencies', icon: GitBranch, desc: 'Service dependency map' },
    ],
  },
  {
    label: 'Infrastructure',
    icon: Server,
    children: [
      { label: 'Infrastructure Overview', href: '/infrastructure', icon: Server, desc: 'All AWS resources' },
      { label: 'Add Resource', href: '/infrastructure/new', icon: Plus, desc: 'Add infrastructure resource' },
      { label: 'Recommendations', href: '/infrastructure/recommendations', icon: Lightbulb, desc: 'AI-powered suggestions' },
      { label: 'Tenants', href: '/tenants', icon: Building, desc: 'Multi-tenant management' },
    ],
  },
  {
    label: 'Costs',
    icon: DollarSign,
    children: [
      { label: 'Cost Overview', href: '/costs', icon: DollarSign, desc: 'Real-time spend tracking' },
      { label: 'Optimization', href: '/cost-optimization', icon: TrendingDown, desc: 'AI savings recommendations' },
      { label: 'Forecast', href: '/forecast', icon: BarChart3, desc: 'Predictive budget forecasting' },
      { label: 'Invoices', href: '/invoices', icon: FileText, desc: 'Billing history' },
      { label: 'AI Reports', href: '/ai-reports', icon: Sparkles, desc: 'AI-generated cost reports' },
      { label: 'Efficiency', href: '/costs/efficiency', icon: Activity, desc: 'Resource efficiency analysis' },
      { label: 'By Team', href: '/costs/by-team', icon: Users, desc: 'Cost attribution by team' },
    ],
  },
  {
    label: 'Security',
    icon: Shield,
    children: [
      { label: 'Security Overview', href: '/security', icon: Shield, desc: 'Security posture and score' },
      { label: 'Anomalies', href: '/anomalies', icon: AlertTriangle, desc: 'Detected threats and issues' },
      { label: 'Anomaly Rules', href: '/anomalies/rules', icon: SlidersHorizontal, desc: 'Custom detection thresholds' },
      { label: 'Compliance', href: '/compliance/frameworks', icon: CheckSquare, desc: 'CIS, NIST, SOC 2 frameworks' },
      { label: 'Audit Logs', href: '/audit-logs', icon: ClipboardList, desc: 'Full activity audit trail' },
    ],
  },
  {
    label: 'Observability',
    icon: Activity,
    children: [
      { label: 'Monitoring Overview', href: '/monitoring',           icon: BarChart3, desc: 'SLOs, response time, health'   },
      { label: 'Active Alerts',       href: '/observability/alerts',        icon: Bell,      desc: 'Live alerts and incidents'      },
      { label: 'Alert History',       href: '/observability/alert-history', icon: Clock,     desc: 'Historical alert timeline'      },
      { label: 'SLO Dashboard',       href: '/monitoring/slos',      icon: Target,    desc: 'Service level objectives'       },
      { label: 'Status Page',         href: '/status',               icon: Activity,  desc: 'Live system status'             },
    ],
  },
  {
    label: 'DevOps',
    icon: GitBranch,
    children: [
      { label: 'DORA Metrics', href: '/app/dora-metrics', icon: BarChart3, desc: 'Deployment frequency and MTTR' },
      { label: 'Teams', href: '/teams', icon: Users, desc: 'Team management and access' },
      { label: 'Enterprise', href: '/enterprise', icon: Building2, desc: 'Enterprise controls' },
      { label: 'Developers', href: '/developers', icon: Code, desc: 'API keys and integrations' },
    ],
  },
];

// Mobile drawer sections (excludes Add Service / Add Resource)
const mobileSections = [
  {
    key: 'services',
    label: 'Services',
    items: [
      { label: 'Services Overview', href: '/services' },
      { label: 'Deployments', href: '/deployments' },
      { label: 'Dependencies', href: '/dependencies' },
    ],
  },
  {
    key: 'infrastructure',
    label: 'Infrastructure',
    items: [
      { label: 'Overview', href: '/infrastructure' },
      { label: 'Recommendations', href: '/cost-optimization' },
      { label: 'Tenants', href: '/infrastructure/tenants' },
    ],
  },
  {
    key: 'costs',
    label: 'Costs',
    items: [
      { label: 'Cost Overview', href: '/costs' },
      { label: 'Optimization', href: '/cost-optimization' },
      { label: 'Forecast', href: '/forecast' },
      { label: 'Invoices', href: '/invoices' },
      { label: 'AI Reports', href: '/ai-reports' },
      { label: 'Efficiency', href: '/costs/efficiency' },
      { label: 'By Team', href: '/costs/by-team' },
    ],
  },
  {
    key: 'security',
    label: 'Security',
    items: [
      { label: 'Security Overview', href: '/security' },
      { label: 'Anomalies', href: '/anomalies' },
      { label: 'Anomaly Rules', href: '/anomalies/rules' },
      { label: 'Compliance', href: '/compliance/frameworks' },
      { label: 'Audit Logs', href: '/audit-logs' },
    ],
  },
  {
    key: 'observability',
    label: 'Observability',
    items: [
      { label: 'Monitoring Overview', href: '/monitoring' },
      { label: 'Active Alerts', href: '/observability/alerts' },
      { label: 'Alert History', href: '/observability/alert-history' },
      { label: 'SLO Dashboard', href: '/monitoring/slos' },
      { label: 'Status Page', href: '/status' },
    ],
  },
  {
    key: 'devops',
    label: 'DevOps',
    items: [
      { label: 'DORA Metrics', href: '/app/dora-metrics' },
      { label: 'Teams', href: '/teams' },
      { label: 'Enterprise', href: '/enterprise' },
      { label: 'Developers', href: '/developers' },
    ],
  },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [hasCriticalAlerts, setHasCriticalAlerts] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setOpenSection(null);
  }, [pathname]);

  // Fetch critical alerts on mount, refresh every 60s
  useEffect(() => {
    const checkAlerts = async () => {
      try {
        const res = await fetch('/api/anomalies');
        if (!res.ok) return;
        const data = await res.json();
        const anomalies = Array.isArray(data) ? data : (data.anomalies ?? []);
        setHasCriticalAlerts(
          anomalies.some((a: { severity?: string }) =>
            a.severity === 'critical' || a.severity === 'high'
          )
        );
      } catch {
        // Never show false positives
        setHasCriticalAlerts(false);
      }
    };
    checkAlerts();
    const interval = setInterval(checkAlerts, 60_000);
    return () => clearInterval(interval);
  }, []);

  const toggleSection = (key: string) => {
    setOpenSection(prev => (prev === key ? null : key));
  };

  const getUserInitials = () => {
    if (!user) return 'U';
    const fullName = user.fullName || '';
    const nameParts = fullName.split(' ');
    if (nameParts.length >= 2) {
      return (nameParts[0].charAt(0) + nameParts[1].charAt(0)).toUpperCase();
    }
    if (fullName) return fullName.charAt(0).toUpperCase();
    return user.email?.charAt(0).toUpperCase() || 'U';
  };

  const getUserName = () => {
    if (!user) return 'Loading...';
    return user.fullName || user.email;
  };

  const handleSearchClick = () => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  const handleLogout = async () => {
    await logout();
  };

  const isItemActive = (item: NavItem): boolean => {
    if (item.href) {
      return pathname === item.href || pathname.startsWith(item.href + '/');
    }
    if (item.children) {
      return item.children.some(
        (child) => pathname === child.href || pathname.startsWith(child.href + '/')
      );
    }
    return false;
  };

  return (
    <header className="w-full border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">

      {/* ── MOBILE TOP BAR (lg:hidden) ── */}
      <div
        className="lg:hidden flex items-center justify-between px-0 h-[68px]"
      >
        {/* Left: Hamburger + Logo grouped */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setMobileMenuOpen(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', borderRadius: '10px', border: 'none', background: 'none', cursor: 'pointer', color: '#0F172A' }}
            aria-label="Open menu"
          >
            <Menu size={26} />
          </button>
          <Link
            href="/dashboard"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', fontWeight: 700, fontSize: '1.2rem', color: '#1e1b4b', letterSpacing: '-0.01em' }}
          >
            <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'linear-gradient(135deg, #2563EB, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>DC</span>
            </div>
            DevControl
          </Link>
        </div>

        {/* Right: Bell + Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
          <Link
            href="/observability/alerts"
            style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', color: '#475569' }}
            aria-label="Alerts"
          >
            <Bell size={24} />
            {hasCriticalAlerts && (
              <span style={{
                position: 'absolute', top: '6px', right: '6px',
                width: '9px', height: '9px', borderRadius: '50%',
                background: '#DC2626', border: '2px solid white',
              }} />
            )}
          </Link>
          {isLoading ? (
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#E2E8F0' }} />
          ) : user ? (
            <UserDropdown
              user={{
                name: getUserName(),
                email: user.email || '',
                initials: getUserInitials(),
              }}
              onLogout={handleLogout}
            />
          ) : (
            <Link href="/login" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none' }}>Sign in</Link>
          )}
        </div>
      </div>

      {/* ── DESKTOP HEADER (hidden on mobile) ── */}
      <div className="hidden lg:flex max-w-[1920px] mx-auto h-16 items-center px-4 md:px-6 lg:px-8">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center gap-2 lg:gap-6">
          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold shrink-0"
          >
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <span className="text-white text-xl font-bold">DC</span>
            </div>
            <span className="text-xl">DevControl</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item);

              if (!item.children) {
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-base font-medium rounded-md transition-colors',
                      'hover:bg-accent hover:text-[#1e1b4b]',
                      isActive ? 'bg-accent text-foreground' : 'text-[#1E293B]'
                    )}
                  >
                    {item.label}
                  </Link>
                );
              }

              return (
                <div
                  key={item.label}
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setActiveDropdown(item.label)}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-base font-medium rounded-md transition-colors',
                      'hover:bg-accent hover:text-[#1e1b4b]',
                      isActive ? 'bg-accent text-foreground' : 'text-[#1E293B]'
                    )}
                  >
                    {item.label}
                    <ChevronDown className={cn('h-3 w-3 transition-transform', activeDropdown === item.label ? 'rotate-180' : '')} />
                  </button>

                  {activeDropdown === item.label && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        zIndex: 50,
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                        padding: '12px',
                        minWidth: '480px',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '4px',
                      }}
                    >
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = pathname === child.href || pathname.startsWith(child.href + '/');
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setActiveDropdown(null)}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '8px',
                              textDecoration: 'none',
                              background: childActive ? '#f5f3ff' : 'transparent',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={(e) => { if (!childActive) e.currentTarget.style.background = '#f5f3ff'; }}
                            onMouseLeave={(e) => { if (!childActive) e.currentTarget.style.background = 'transparent'; }}
                          >
                            <div style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <ChildIcon size={16} style={{ color: '#7c3aed' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e1b4b', lineHeight: 1.3 }}>{child.label}</div>
                              <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '2px' }}>{child.desc}</div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Right: Search + Actions + User */}
        <div className="ml-auto flex items-center gap-2 lg:gap-3 shrink-0">
          {/* Search Trigger (Cmd+K) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSearchClick}
            className="hidden md:flex items-center gap-2 text-base text-slate-500 md:w-32 lg:w-48 justify-start rounded-lg border border-slate-200 bg-white hover:border-slate-300"
          >
            <Search className="h-4 w-4" />
            <span>Search...</span>
            <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>

          {/* Quick Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="default" className="gap-1.5 shrink-0 bg-violet-700 hover:bg-violet-800 text-white px-3 py-1.5">
                <Plus className="h-4 w-4" />
                <span className="hidden lg:inline">New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <DropdownMenuItem
                    key={action.href}
                    onClick={() => router.push(action.href)}
                  >
                    {Icon && <Icon className="mr-2 h-4 w-4" />}
                    {action.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          {isLoading ? (
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
          ) : user ? (
            <UserDropdown
              user={{
                name: getUserName(),
                email: user.email || '',
                initials: getUserInitials(),
              }}
              onLogout={handleLogout}
            />
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>

      {/* ── MOBILE DRAWER ── */}
      {mobileMenuOpen && (
        <div className="lg:hidden" style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          {/* Overlay */}
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
          />

          {/* Drawer */}
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: '85vw', maxWidth: '320px',
            background: '#fff', display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            {/* Drawer header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 16px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0F172A' }}>DevControl</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '6px', border: 'none', background: '#F1F5F9', cursor: 'pointer', color: '#475569' }}
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>

            {/* Nav sections */}
            <div style={{ flex: 1 }}>
              {mobileSections.map((section) => (
                <div key={section.key}>
                  <button
                    onClick={() => toggleSection(section.key)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '14px 20px',
                      fontSize: '1rem', fontWeight: 600, color: '#1e1b4b',
                      background: 'none', border: 'none', borderBottom: '1px solid #F1F5F9',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {section.label}
                    <ChevronDown
                      size={16}
                      style={{
                        color: '#94A3B8',
                        transform: openSection === section.key ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s',
                        flexShrink: 0,
                      }}
                    />
                  </button>

                  {openSection === section.key && (
                    <div style={{ background: '#F8FAFC', padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
                      {section.items.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            style={{
                              display: 'block', padding: '10px 32px',
                              fontSize: '0.9rem',
                              color: isActive ? '#7C3AED' : '#475569',
                              fontWeight: isActive ? 600 : 400,
                              textDecoration: 'none',
                              background: isActive ? '#F5F3FF' : 'transparent',
                            }}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom: Settings */}
            <Link
              href="/settings"
              style={{
                display: 'block', padding: '16px 20px',
                fontSize: '0.9rem', color: '#475569',
                borderTop: '1px solid #F1F5F9',
                textDecoration: 'none', flexShrink: 0,
              }}
            >
              ⚙ Settings
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
