'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Layers,
  Rocket,
  Server,
  Users,
  Plus,
  Search,
  Menu,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { NavDropdown } from '@/components/ui/nav-dropdown';
import { UserDropdown } from '@/components/ui/user-dropdown';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  appNav,
  solutionsNav,
  resourcesNav,
  marketingStandaloneLinks,
  quickActions,
} from '@/lib/navigation-config';
import { useState } from 'react';

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="max-w-[1920px] mx-auto flex h-16 items-center px-4 md:px-6 lg:px-8">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center gap-2 lg:gap-6">
          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold shrink-0"
          >
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">DC</span>
            </div>
            <span className="hidden lg:inline-block text-xl">DevControl</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {/* Platform Dropdown */}
            <NavDropdown group={appNav} />

            {/* Solutions Dropdown */}
            <NavDropdown group={solutionsNav} />

            {/* Resources Dropdown */}
            <NavDropdown group={resourcesNav} />

            {/* Standalone Links - Pricing, Enterprise, Developers */}
            {marketingStandaloneLinks.map((link) => {
              const isActive =
                pathname === link.href || pathname.startsWith(link.href + '/');
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'px-3 py-2 text-base font-medium rounded-md transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {link.label}
                </Link>
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
              {quickActions.map((action, idx) => {
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
          <div className="px-4 py-4 space-y-4">
            {/* Platform Links */}
            <div>
              <div className="text-xs uppercase text-muted-foreground font-semibold mb-2 px-2">
                Platform
              </div>
              <div className="space-y-1">
                {appNav.sections?.map((section) =>
                  section.items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      pathname.startsWith(item.href + '/');
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors',
                          'hover:bg-accent',
                          isActive
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground'
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {Icon && <Icon className="w-4 h-4" />}
                        {item.label}
                      </Link>
                    );
                  })
                )}
              </div>
            </div>

            <DropdownMenuSeparator />

            {/* Solutions Links */}
            <div>
              <div className="text-xs uppercase text-muted-foreground font-semibold mb-2 px-2">
                Solutions
              </div>
              <div className="space-y-1">
                {solutionsNav.sections?.map((section) =>
                  section.items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      pathname.startsWith(item.href + '/');
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors',
                          'hover:bg-accent',
                          isActive
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground'
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {Icon && <Icon className="w-4 h-4" />}
                        {item.label}
                      </Link>
                    );
                  })
                )}
              </div>
            </div>

            <DropdownMenuSeparator />

            {/* Resources Links */}
            <div>
              <div className="text-xs uppercase text-muted-foreground font-semibold mb-2 px-2">
                Resources
              </div>
              <div className="space-y-1">
                {resourcesNav.items?.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors',
                        'hover:bg-accent',
                        isActive
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground'
                      )}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {Icon && <Icon className="w-4 h-4" />}
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            <DropdownMenuSeparator />

            {/* Standalone Links - Pricing, Enterprise, Developers */}
            {marketingStandaloneLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'block px-3 py-2 text-sm font-medium rounded-md transition-colors',
                  'hover:bg-accent',
                  pathname === link.href
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground'
                )}
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
