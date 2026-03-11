'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Play, Check } from 'lucide-react'
import { AnimatedBackground } from './AnimatedBackground'

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
}

export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden flex items-center"
      style={{ width: '100%', paddingTop: '136px', paddingBottom: '32px' }}
    >
      <AnimatedBackground />
      <div className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(to bottom, #faf5ff, #ffffff)' }} />

      <div style={{ ...inner, width: '100%', textAlign: 'center' }}>
        <h1 className="font-extrabold leading-tight" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', marginBottom: '20px' }}>
          <span style={{ color: '#7c3aed' }}>Stop Firefighting</span>
          <br />
          <span style={{ color: '#111827' }}>Your AWS Infrastructure</span>
        </h1>

        <p className="leading-relaxed" style={{ fontSize: '1.25rem', color: '#6b7280', maxWidth: '680px', margin: '0 auto 16px' }}>
          DevControl gives engineering teams complete visibility into costs, 
security, and performance — before problems become incidents.
        </p>

        <p
          className="font-bold"
          style={{
            fontSize: '1.1rem',
            color: '#111827',
            letterSpacing: '0.02em',
            marginBottom: '36px',
          }}
        >
          Ship faster.{' '}
          <span style={{ color: '#7c3aed' }}>Spend less.</span>{' '}
          Reduce risk.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4" style={{ marginBottom: '24px' }}>
          <Button
            size="lg"
            style={{ backgroundColor: '#7c3aed' }}
            className="hover:opacity-90 text-lg px-8 py-6 hover:scale-105 transition-all shadow-lg hover:shadow-xl text-white"
            asChild
          >
            <Link href="/register">
              Connect AWS Account
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="text-lg px-8 py-6 hover:scale-105 transition-all border-2 hover:shadow-lg"
            style={{ borderColor: '#e5e7eb' }}
          >
            <Play className="mr-2 h-5 w-5" />
            Watch Demo
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6" style={{ color: '#374151', fontSize: '14px', fontWeight: '500', marginBottom: '48px' }}>
         <div className="flex items-center gap-2">
  <Check className="h-4 w-4" style={{ color: '#16a34a', strokeWidth: 2.5 }} />
  <span>15-min setup</span>
</div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" style={{ color: '#16a34a', strokeWidth: 2.5 }} />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" style={{ color: '#16a34a', strokeWidth: 2.5 }} />
            <span>14-day free trial</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" style={{ color: '#16a34a', strokeWidth: 2.5 }} />
            <span>Read-only access</span>
          </div>
        </div>

      </div>
    </section>
  )
}