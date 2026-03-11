'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Play, Check } from 'lucide-react'
import { AnimatedBackground } from './AnimatedBackground'

const inner: React.CSSProperties = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 48px',
}

export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden flex items-center"
      style={{ width: '100%', paddingTop: '120px', paddingBottom: '32px' }}
    >
      <AnimatedBackground />
      <div className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(to bottom, #faf5ff, #ffffff)' }} />

      <div style={{ ...inner, width: '100%', textAlign: 'center' }}>
        <h1 className="font-extrabold leading-tight" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', marginBottom: '20px' }}>
          <span style={{ color: '#7c3aed' }}>Stop Firefighting</span>
          <br />
          <span style={{ color: '#111827' }}>Your AWS Infrastructure</span>
        </h1>

        <p className="leading-relaxed" style={{ fontSize: '1.25rem', color: '#6b7280', marginBottom: '36px', maxWidth: '680px', margin: '0 auto 36px' }}>
          See costs, security, and performance in one AI-powered control center — before problems become incidents.
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

        <div className="flex flex-wrap items-center justify-center gap-6" style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '48px' }}>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" style={{ color: '#16a34a' }} />
            <span>2-minute setup</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" style={{ color: '#16a34a' }} />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" style={{ color: '#16a34a' }} />
            <span>14-day free trial</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" style={{ color: '#16a34a' }} />
            <span>Read-only access</span>
          </div>
        </div>

        <div
          className="rounded-2xl"
          style={{
            background: '#fff',
            border: '1px solid #f3f4f6',
            boxShadow: '0 8px 32px rgba(124,58,237,0.08)',
            padding: '32px',
            maxWidth: '700px',
            margin: '0 auto',
          }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: '$2,400', label: 'avg monthly savings' },
              { value: '15min', label: 'setup time' },
              { value: '99.9%', label: 'platform uptime' },
              { value: 'SOC 2', label: 'ready' },
            ].map((stat, i) => (
              <div key={stat.label} className="text-center" style={i > 0 ? { borderLeft: '1px solid #f3f4f6' } : {}}>
                <div className="font-extrabold text-2xl" style={{ color: '#7c3aed' }}>{stat.value}</div>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
