import { TopNav } from '@/components/layout/top-nav'
import { ErrorBoundary } from '@/components/error-boundary'
import { CommandPalette } from '@/components/command-palette'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation - Vercel Style */}
      <TopNav />

      {/* Main Content Area */}
      <main className="container mx-auto py-6">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette />
    </div>
  )
}
