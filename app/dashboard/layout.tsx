import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      {/* Sidebar - Fixed Left */}
      <Sidebar />

      {/* Header - Fixed Top (with left margin for sidebar) */}
      <Header />

      {/* Main Content Area */}
      <main className="ml-60 pt-16">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
