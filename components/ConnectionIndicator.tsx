'use client'

import { useWebSocket } from '@/lib/hooks/useWebSocket';

export function ConnectionIndicator() {
  const { isConnected } = useWebSocket();

  return (
    <div className="fixed bottom-4 left-4 flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs shadow-lg z-50">
      <div
        className={`h-2 w-2 rounded-full ${
          isConnected
            ? 'bg-green-500 animate-pulse'
            : 'bg-red-500'
        }`}
      />
      <span className="text-gray-700 dark:text-gray-300">
        {isConnected ? 'Connected' : 'Reconnecting...'}
      </span>
    </div>
  );
}
