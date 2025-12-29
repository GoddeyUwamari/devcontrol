'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Layers, Network, Rocket, Server, Users, Activity, TrendingUp, Plus, Search, AlertTriangle } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/contexts/auth-context'

const navigation = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Services', href: '/services', icon: Layers },
  { name: 'Dependencies', href: '/dependencies', icon: Network },
  { name: 'Deployments', href: '/deployments', icon: Rocket },
  { name: 'Infrastructure', href: '/infrastructure', icon: Server },
  { name: 'Teams', href: '/teams', icon: Users },
  { name: 'Monitoring', href: '/admin/monitoring', icon: Activity },
  { name: 'DORA Metrics', href: '/admin/dora-metrics', icon: TrendingUp },
  { name: 'Alerts', href: '/admin/alerts', icon: AlertTriangle },
]

export function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isLoading } = useAuth()

  // Debug log
  console.log('👤 TopNav - Current user:', user)

  const getUserInitials = () => {
    if (!user) return 'U'

    const fullName = user.fullName || ''
    const nameParts = fullName.split(' ')

    if (nameParts.length >= 2) {
      return (nameParts[0].charAt(0) + nameParts[1].charAt(0)).toUpperCase()
    }

    if (fullName) {
      return fullName.charAt(0).toUpperCase()
    }

    return user.email?.charAt(0).toUpperCase() || 'U'
  }

  const getUserName = () => {
    if (!user) return 'Loading...'
    return user.fullName || user.email
  }

  const handleSearchClick = () => {
    // This will be connected to the command palette
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center pl-6 pr-8">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center gap-8 flex-1">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">DC</span>
            </div>
            <span className="hidden md:inline-block">DevControl</span>
          </Link>

          {/* Navigation Links - Hidden on mobile */}
          <nav className="hidden md:flex items-center gap-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                    'hover:bg-accent hover:text-accent-foreground',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {item.name}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Right: Search + Actions + User */}
        <div className="flex items-center gap-3">
          {/* Search Trigger (Cmd+K) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSearchClick}
            className="hidden md:flex items-center gap-2 text-sm text-muted-foreground md:w-48 lg:w-64 justify-start"
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
          >
            <Search className="h-5 w-5" />
          </Button>

          {/* Quick Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                <span className="hidden md:inline">New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => router.push('/services/new')}>
                <Layers className="mr-2 h-4 w-4" />
                Create Service
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/deployments/new')}>
                <Rocket className="mr-2 h-4 w-4" />
                Record Deployment
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/infrastructure/new')}>
                <Server className="mr-2 h-4 w-4" />
                Add Infrastructure
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/teams/new')}>
                <Users className="mr-2 h-4 w-4" />
                Create Team
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{getUserName()}</p>
                <p className="text-xs text-muted-foreground">{user?.email || 'Loading...'}</p>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t px-4 py-2 overflow-x-auto">
        <nav className="flex gap-1 min-w-max">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')

            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {item.name}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}