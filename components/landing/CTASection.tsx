'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
}

export function CTASection() {
  return (
    <section
      style={{
        width: '100%',
        padding: '64px 0',
        background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%)',
      }}
    >
      <div style={inner}>
        <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center', color: '#fff' }}>
          <h2 className="font-extrabold" style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', marginBottom: '16px', lineHeight: 1.2 }}>
            Your AWS bill is too high.<br />Let&apos;s fix that.
          </h2>
          <p style={{ fontSize: '1.125rem', color: '#ddd6fe', marginBottom: '36px', lineHeight: 1.7 }}>
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

          <p style={{ fontSize: '13px', color: '#c4b5fd', marginTop: '24px' }}>
            No credit card required · 14-day free trial · Cancel anytime
          </p>
        </div>
      </div>
    </section>
  )
}
