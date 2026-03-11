'use client'

import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/contexts/auth-context'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/tenants': 'Tenants',
  '/subscriptions': 'Subscriptions',
  '/invoices': 'Invoices',
}

export function Header() {
  const pathname = usePathname()
  const { user, isLoading } = useAuth()

  // Debug log
  console.log('👤 Header - Current user:', user)

  // Get the page title based on the current route
  const getPageTitle = () => {
    // Check for exact match first
    if (pageTitles[pathname]) {
      return pageTitles[pathname]
    }

    // Check for partial match (e.g., /tenants/123 -> Tenants)
    for (const [path, title] of Object.entries(pageTitles)) {
      if (pathname.startsWith(path + '/')) {
        return title
      }
    }

    return 'Dashboard'
  }

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
    <header className="fixed top-0 left-60 right-0 h-16 bg-white border-b border-gray-200 z-10">
      <div className="h-full px-6 flex items-center justify-between">
        {/* Page Title */}
        <h1 className="text-2xl font-semibold text-gray-900">{getPageTitle()}</h1>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Avatar className="w-9 h-9">
                <AvatarImage src="/avatar.png" alt="User" />
                <AvatarFallback className="bg-[#7c3aed] text-white text-sm">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
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
    </header>
  )
}
