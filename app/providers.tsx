'use client'

import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { clearLegacyDemoFlags } from '@/lib/legacy-demo-cleanup'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    clearLegacyDemoFlags()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
      </AuthProvider>
    </QueryClientProvider>
  )
}
