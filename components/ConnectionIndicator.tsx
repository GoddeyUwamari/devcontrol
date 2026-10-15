'use client'

import { useWebSocket } from '@/lib/hooks/useWebSocket';

/**
 * The live-update channel's state (the socket to the backend), not the AWS
 * connection: it shows on every page, connected to AWS or not, so it never
 * says "Connected".
 */
export function ConnectionIndicator() {
  const { isConnected } = useWebSocket();
  const label = isConnected ? 'Live updates' : 'Live updates paused';

  return (
    <div
      role="status"
      aria-label={label}
      data-testid="connection-indicator"
      className="fixed bottom-4 left-4 flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs shadow-lg z-50"
    >
      <div
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          isConnected
            ? 'bg-green-500 animate-pulse'
            : 'bg-red-500'
        }`}
      />
      <span className="text-gray-700 dark:text-gray-300">
        {label}
      </span>
    </div>
  );
}
