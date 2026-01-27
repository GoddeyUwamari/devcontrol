'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * MarketingNav Component
 *
 * Fixed top navigation for the public landing page.
 * Features glassmorphism effect with backdrop blur and mobile hamburger menu.
 */
export function MarketingNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navLinks = [
    { href: '#features', label: 'Features' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/docs', label: 'Docs' },
  ]

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">DC</span>
          </div>
          <span>DevControl</span>
        </Link>

        {/* Center Links - Hidden on mobile */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right Actions - Desktop */}
        <div className="hidden md:flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Login</Link>
          </Button>
          <Button size="sm" className="bg-[#635BFF] hover:bg-[#4f46e5]" asChild>
            <Link href="/register">Get Started Free</Link>
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileMenuOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      </div>

      {/* Mobile Menu Drawer */}
      <div
        className={cn(
          'md:hidden absolute top-16 left-0 right-0 bg-background border-b shadow-lg transition-all duration-300 ease-in-out overflow-hidden',
          mobileMenuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="container mx-auto px-4 py-4 space-y-4">
          {/* Nav Links */}
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block py-2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}

          {/* Divider */}
          <hr className="border-gray-200" />

          {/* Mobile Auth Buttons */}
          <div className="flex flex-col gap-3 pt-2">
            <Button variant="outline" className="w-full" asChild>
              <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                Login
              </Link>
            </Button>
            <Button className="w-full bg-[#635BFF] hover:bg-[#4f46e5]" asChild>
              <Link href="/register" onClick={() => setMobileMenuOpen(false)}>
                Get Started Free
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Backdrop for mobile menu */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 top-16 bg-black/20 backdrop-blur-sm z-[-1]"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </nav>
  )
}
