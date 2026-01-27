'use client'

import { useEffect, useState, useRef } from 'react'
import { DollarSign, TrendingUp, Clock } from 'lucide-react'

/**
 * StatsRow Component
 *
 * Displays key metrics in a 3-column grid for social proof.
 * Features count-up animation on scroll with icons and sublabels.
 */

function useCountUp(end: number, duration: number = 2000, start: number = 0, isVisible: boolean) {
  const [count, setCount] = useState(start)

  useEffect(() => {
    if (!isVisible) return

    let startTimestamp: number | null = null
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / duration, 1)
      setCount(Math.floor(progress * (end - start) + start))
      if (progress < 1) {
        window.requestAnimationFrame(step)
      }
    }
    window.requestAnimationFrame(step)
  }, [end, duration, start, isVisible])

  return count
}

export function StatsRow() {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [])

  const savingsCount = useCountUp(2400, 2000, 0, isVisible)
  const roiCount = useCountUp(10, 1500, 0, isVisible)
  const uptimeCount = useCountUp(99.9, 2000, 95, isVisible)

  const stats = [
    {
      icon: DollarSign,
      value: `$${savingsCount.toLocaleString()}`,
      label: 'Avg monthly savings',
      sublabel: 'per team',
      color: 'text-green-600',
      bgColor: 'bg-green-100',
    },
    {
      icon: TrendingUp,
      value: `${roiCount}x`,
      label: 'ROI in first 90 days',
      sublabel: 'guaranteed',
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      icon: Clock,
      value: `${uptimeCount.toFixed(1)}%`,
      label: 'Uptime SLA',
      sublabel: 'enterprise-grade',
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
  ]

  return (
    <div ref={ref} className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
      {stats.map((stat, index) => {
        const Icon = stat.icon
        return (
          <div
            key={index}
            className="text-center p-6 bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow"
          >
            <div className={`inline-flex p-3 rounded-full ${stat.bgColor} mb-4`}>
              <Icon className={`h-6 w-6 ${stat.color}`} />
            </div>
            <div className="text-4xl md:text-5xl font-bold text-[#635BFF] mb-2">
              {stat.value}
            </div>
            <div className="text-muted-foreground font-medium">
              {stat.label}
            </div>
            <div className="text-sm text-muted-foreground/70 mt-1">
              {stat.sublabel}
            </div>
          </div>
        )
      })}
    </div>
  )
}
