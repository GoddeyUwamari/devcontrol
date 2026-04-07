'use client'

import { useState } from 'react'

/**
 * DashboardPreview Component
 *
 * Displays a dashboard screenshot with browser chrome.
 * Falls back to placeholder if image doesn't exist.
 */
export function DashboardPreview() {
  const [imageError, setImageError] = useState(false)

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
      {/* Browser Chrome */}
      <div className="bg-white rounded-t-xl border border-gray-200 shadow-2xl overflow-hidden">
        {/* Browser Header */}
        <div className="bg-gray-100 border-b border-gray-200 px-4 py-3 flex items-center gap-2">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 mx-4">
            <div className="bg-white rounded-md px-3 py-1 text-xs text-gray-500 border border-gray-200">
              app.getdevcontrol.com/dashboard
            </div>
          </div>
        </div>

        {/* Dashboard Screenshot or Placeholder */}
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-8">
          {!imageError ? (
            <img
              src="/landing/dashboard-preview.png"
              alt="DevControl Dashboard"
              className="rounded-lg shadow-xl w-full"
              onError={() => setImageError(true)}
            />
          ) : (
            /* Placeholder if image doesn't exist */
            <div className="bg-gradient-to-br from-purple-50 to-purple-50 rounded-lg aspect-video flex flex-col items-center justify-center border-2 border-dashed border-gray-300">
              <div className="text-6xl mb-4">📊</div>
              <p className="text-lg font-semibold text-gray-700 mb-2">Dashboard Preview</p>
              <p className="text-sm text-gray-500">
                Add screenshot at /public/landing/dashboard-preview.png
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
