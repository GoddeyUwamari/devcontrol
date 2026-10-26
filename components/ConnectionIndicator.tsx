'use client'

import { cn } from '@/lib/utils';

/**
 * The live-update channel's state (the socket to the backend), not the AWS
 * connection: it shows on every page, connected to AWS or not, so it never
 * says "Connected". It sits in the top nav, which reads the socket once and
 * passes its state to the indicator in each bar; it is never fixed over the
 * page. Below `compactBelow` only the dot shows: the label stays the status's
 * accessible name and the dot's tooltip.
 */
export function ConnectionIndicator({ isConnected, compactBelow }: { isConnected: boolean; compactBelow: 'sm' | 'xl' }) {
  const label = isConnected ? 'Live updates' : 'Live updates paused';

  return (
    <div
      role="status"
      aria-label={label}
      title={label}
      data-testid="connection-indicator"
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-full p-2 text-label font-normal',
        compactBelow === 'sm'
          ? 'sm:border sm:border-gray-200 sm:bg-white sm:px-3 sm:py-1.5 sm:dark:border-gray-700 sm:dark:bg-gray-800'
          : 'xl:border xl:border-gray-200 xl:bg-white xl:px-3 xl:py-1.5 xl:dark:border-gray-700 xl:dark:bg-gray-800'
      )}
    >
      <div
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${
          isConnected
            ? 'bg-green-500 animate-pulse'
            : 'bg-red-500'
        }`}
      />
      <span className={cn('text-ink-body dark:text-gray-300', compactBelow === 'sm' ? 'sr-only sm:not-sr-only' : 'sr-only xl:not-sr-only')}>
        {label}
      </span>
    </div>
  );
}
