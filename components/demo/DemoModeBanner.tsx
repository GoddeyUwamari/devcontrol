'use client'

import { X, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DemoModeBannerProps {
  onExit: () => void
}

export function DemoModeBanner({ onExit }: DemoModeBannerProps) {
  return (
    <div className="bg-gradient-to-r from-purple-600 via-purple-600 to-indigo-600 text-white px-6 py-4 rounded-xl shadow-lg relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2" />
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Emoji Icon */}
            <span className="text-2xl">🎭</span>

            {/* Content */}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">Demo Mode Active</h3>
                <span className="text-sm text-purple-200">—</span>
                <span className="text-sm text-purple-100">Viewing Sample Data</span>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  color: '#7C3AED',
                  background: '#EEEDFE',
                  border: '1px solid #AFA9EC',
                  padding: '2px 8px',
                  borderRadius: '100px',
                  marginLeft: '8px',
                  letterSpacing: '0.04em',
                }}>
                  Simulated Data
                </span>
              </div>
            </div>
          </div>

          {/* Exit Button */}
          <Button
            onClick={onExit}
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/20 border border-white/30 hover:border-white/50 transition-all"
          >
            <X className="w-4 h-4 mr-2" />
            Exit Demo
          </Button>
        </div>

        {/* Info - Collapsible hint */}
        <div className="mt-3 flex items-center gap-2 text-sm text-purple-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p>
            All data shown is sample data. Your real infrastructure is not affected.
            Press <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-xs font-mono mx-1">D</kbd> to toggle.
          </p>
        </div>
      </div>
    </div>
  )
}
