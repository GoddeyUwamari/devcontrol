'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Layers, Rocket, Server, Activity, Sparkles, AlertTriangle, LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/contexts/auth-context'

interface NavigationItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

const navigation: NavigationItem[] = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Services', href: '/services', icon: Layers },
  { name: 'Deployments', href: '/deployments', icon: Rocket },
  { name: 'Infrastructure', href: '/infrastructure', icon: Server },
  { name: 'Teams', href: '/teams', icon: Users },
  { name: 'Monitoring', href: '/admin/monitoring', icon: Activity },
  { name: 'Anomaly Detection', href: '/anomalies', icon: AlertTriangle, badge: 'AI' },
  { name: 'AI Reports', href: '/ai-reports', icon: Sparkles, badge: 'New' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, isLoading } = useAuth()

  // Debug log
  console.log('👤 Sidebar - Current user:', user)

  // Get user initials for avatar
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

  // Get user display name
  const getUserName = () => {
    if (!user) return 'Loading...'
    return user.fullName || user.email
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-[#0A2540] flex flex-col">
      {/* Logo/Brand */}
      <div className="h-16 flex items-center px-6 border-b border-white/10">
        <h1 className="text-xl font-bold text-white">Platform Portal</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[#635BFF] text-white'
                  : 'text-gray-300 hover:bg-white/5 hover:text-white'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="flex-1">{item.name}</span>
              {item.badge && (
                <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-500 text-white rounded">
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* User Menu */}
      <div className="p-4 border-t border-white/10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-white/5 transition-colors">
              <Avatar className="w-8 h-8">
                <AvatarImage src="/avatar.png" alt="User" />
                <AvatarFallback className="bg-[#635BFF] text-white text-sm">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-white">{getUserName()}</p>
                <p className="text-xs text-gray-400">{user?.email || 'Loading...'}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{getUserName()}</p>
              <p className="text-xs text-muted-foreground">{user?.email || 'Loading...'}</p>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
