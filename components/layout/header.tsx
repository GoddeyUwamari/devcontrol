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

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/tenants': 'Tenants',
  '/subscriptions': 'Subscriptions',
  '/invoices': 'Invoices',
}

export function Header() {
  const pathname = usePathname()

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

  const handleLogout = () => {
    // TODO: Implement logout logic
    console.log('Logging out...')
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
                <AvatarFallback className="bg-[#635BFF] text-white text-sm">
                  JD
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleLogout} className="text-red-600 cursor-pointer">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
