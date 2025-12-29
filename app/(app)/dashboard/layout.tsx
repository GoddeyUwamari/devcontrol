export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Parent (app) layout already provides TopNav, ErrorBoundary, and CommandPalette
  // This layout just passes through children
  return <>{children}</>
}
