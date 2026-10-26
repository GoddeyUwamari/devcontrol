'use client'

import { useWebSocket } from '@/lib/hooks/useWebSocket';

/**
 * The live-update channel's state (the socket to the backend), not the AWS
 * connection: it shows on every page, connected to AWS or not, so it never
 * says "Connected". It floats as a fixed pill in the bottom-left corner of
 * every page (founder decision, Oct 26), so it can overlay content there
 * while scrolling.
 */
export function ConnectionIndicator() {
  const { isConnected } = useWebSocket();
  const label = isConnected ? 'Live updates' : 'Live updates paused';

  return (
    <div
      role="status"
      aria-label={label}
      data-testid="connection-indicator"
      className="fixed bottom-4 left-4 flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-label font-normal shadow-lg z-50"
    >
      <div
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          isConnected
            ? 'bg-green-500 animate-pulse'
            : 'bg-red-500'
        }`}
      />
      <span className="text-ink-body dark:text-gray-300">
        {label}
      </span>
    </div>
  );
}
