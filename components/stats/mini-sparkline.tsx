'use client'

interface MiniSparklineProps {
  data: number[]
  color?: 'green' | 'blue' | 'red' | 'gray' | 'purple' | 'orange'
  height?: number
  showGradient?: boolean
}

export function MiniSparkline({
  data,
  color = 'blue',
  height = 50,
  showGradient = true,
}: MiniSparklineProps) {
  if (!data || data.length === 0) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  // Generate SVG path
  const width = 100
  const padding = 4
  const stepX = (width - padding * 2) / (data.length - 1)

  const points = data.map((value, index) => {
    const x = padding + index * stepX
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return { x, y }
  })

  const pathD = `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}`

  // Create area path for gradient fill
  const areaD = `${pathD} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`

  // Color configuration
  const colorConfig = {
    green: {
      stroke: '#10b981',
      gradientStart: '#10b981',
      gradientEnd: 'transparent',
    },
    blue: {
      stroke: '#3b82f6',
      gradientStart: '#3b82f6',
      gradientEnd: 'transparent',
    },
    red: {
      stroke: '#ef4444',
      gradientStart: '#ef4444',
      gradientEnd: 'transparent',
    },
    gray: {
      stroke: '#9ca3af',
      gradientStart: '#9ca3af',
      gradientEnd: 'transparent',
    },
    purple: {
      stroke: '#a855f7',
      gradientStart: '#a855f7',
      gradientEnd: 'transparent',
    },
    orange: {
      stroke: '#f97316',
      gradientStart: '#f97316',
      gradientEnd: 'transparent',
    },
  }

  const config = colorConfig[color]
  const gradientId = `sparkline-gradient-${color}-${Math.random().toString(36).substr(2, 9)}`
  const lastPoint = points[points.length - 1]

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full overflow-hidden"
    >
      {/* Gradient Definition */}
      {showGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={config.gradientStart} stopOpacity="0.3" />
            <stop offset="100%" stopColor={config.gradientEnd} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}

      {/* Area fill with gradient */}
      {showGradient && (
        <path
          d={areaD}
          fill={`url(#${gradientId})`}
          className="transition-all duration-500"
        />
      )}

      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke={config.stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-500"
      />

      {/* Animated dot at the end */}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r="4"
        fill={config.stroke}
        className="animate-pulse"
      />

      {/* Outer ring for the dot */}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r="6"
        fill="none"
        stroke={config.stroke}
        strokeWidth="1.5"
        strokeOpacity="0.3"
        className="animate-ping"
        style={{ animationDuration: '2s' }}
      />
    </svg>
  )
}
