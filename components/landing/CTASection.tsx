'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

export function CTASection() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640

  return (
    <section
      style={{
        width: '100%',
        padding: isMobile ? '48px 0' : '64px 0',
        background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%)',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : '0 32px' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center', color: '#fff' }}>
          <h2 className="font-extrabold" style={{ fontSize: isMobile ? 'clamp(1.5rem, 4vw, 2rem)' : 'clamp(1.75rem, 4vw, 2.75rem)', marginBottom: isMobile ? '12px' : '16px', lineHeight: 1.2 }}>
            Your AWS bill is too high.<br />Let&apos;s fix that.
          </h2>
          <p style={{ fontSize: isMobile ? '1rem' : '1.125rem', color: '#ddd6fe', marginBottom: isMobile ? '28px' : '36px', lineHeight: 1.7 }}>
            Join 500+ engineering teams saving an average of $2,400/month with DevControl.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              style={{ color: '#7c3aed' }}
              className="text-lg px-8 py-6 bg-white hover:bg-gray-100 hover:scale-105 transition-all shadow-lg font-bold"
              asChild
            >
              <Link href="/register">
                Scan My AWS for Waste
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-lg px-8 py-6 bg-white/10 border-2 border-white/30 text-white hover:bg-white/20 hover:scale-105 transition-all font-bold"
              asChild
            >
              <Link href="/contact">
                Talk to Sales
              </Link>
            </Button>
          </div>

          <p style={{ fontSize: isMobile ? '12px' : '13px', color: '#c4b5fd', marginTop: '24px' }}>
            No credit card required · 14-day free trial · Cancel anytime
          </p>
        </div>
      </div>
    </section>
  )
}
