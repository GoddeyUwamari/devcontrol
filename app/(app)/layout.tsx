import { TopNav } from '@/components/layout/top-nav'
import { ErrorBoundary } from '@/components/error-boundary'
import { CommandPalette } from '@/components/command-palette'
import { ConnectionIndicator } from '@/components/ConnectionIndicator'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation - Shows on all authenticated pages */}
      <TopNav />

      {/* Main Content Area */}
      <main>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette />

      {/* WebSocket Connection Indicator */}
      <ConnectionIndicator />
    </div>
  )
}
