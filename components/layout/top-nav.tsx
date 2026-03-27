'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Layers, Server, DollarSign, Shield, GitBranch,
  Plus, Rocket, Activity, Lightbulb, Building, TrendingDown,
  BarChart3, FileText, Sparkles, AlertTriangle, CheckSquare,
  ClipboardList, Users, Building2, Code, ChevronDown, BellDot,
  Search, Menu, X, Bell, Clock, Target,
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
import { useState } from 'react';

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
    ],
  },
  {
    label: 'Security',
    icon: Shield,
    children: [
      { label: 'Security Overview', href: '/security', icon: Shield, desc: 'Security posture and score' },
      { label: 'Anomalies', href: '/anomalies', icon: AlertTriangle, desc: 'Detected threats and issues' },
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

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const getUserInitials = () => {
    if (!user) return 'U';

    const fullName = user.fullName || '';
    const nameParts = fullName.split(' ');

    if (nameParts.length >= 2) {
      return (nameParts[0].charAt(0) + nameParts[1].charAt(0)).toUpperCase();
    }

    if (fullName) {
      return fullName.charAt(0).toUpperCase();
    }

    return user.email?.charAt(0).toUpperCase() || 'U';
  };

  const getUserName = () => {
    if (!user) return 'Loading...';
    return user.fullName || user.email;
  };

  const handleSearchClick = () => {
    // This will be connected to the command palette
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
      <div className="max-w-[1920px] mx-auto flex h-16 items-center px-4 md:px-6 lg:px-8">
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
            <span className="hidden lg:inline-block text-xl">DevControl</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item);

              if (!item.children) {
                // Simple link
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-base font-medium rounded-md transition-colors',
                      'hover:bg-accent hover:text-[#0F172A]',
                      isActive ? 'bg-accent text-foreground' : 'text-[#1E293B]'
                    )}
                  >
                    {item.label}
                  </Link>
                );
              }

              // Dropdown item
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
                      'hover:bg-accent hover:text-[#0F172A]',
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
                              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>{child.label}</div>
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
          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 hover:bg-accent rounded-md transition-colors"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>

          {/* Search Trigger (Cmd+K) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSearchClick}
            className="hidden md:flex items-center gap-2 text-sm text-muted-foreground md:w-32 lg:w-48 justify-start"
          >
            <Search className="h-4 w-4" />
            <span>Search...</span>
            <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>

          {/* Mobile Search Icon */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSearchClick}
            className="md:hidden"
            aria-label="Search"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </Button>

          {/* Quick Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5 shrink-0 bg-blue-600 hover:bg-blue-700 text-white">
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

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t bg-background">
          <div className="px-4 py-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item);

              if (!item.children) {
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                      'hover:bg-accent',
                      isActive ? 'bg-accent text-foreground' : 'text-muted-foreground'
                    )}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              }

              return (
                <div key={item.label}>
                  <div className={cn(
                    'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </div>
                  <div className="ml-7 space-y-1">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      const childActive = pathname === child.href || pathname.startsWith(child.href + '/');
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            'flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
                            'hover:bg-accent',
                            childActive ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
                          )}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <ChildIcon className="w-3.5 h-3.5" />
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
