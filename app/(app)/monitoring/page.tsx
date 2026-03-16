'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MonitoringRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/admin/monitoring')
  }, [router])
  return null
}
