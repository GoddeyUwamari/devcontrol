'use client'

import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { coversKeepClear } from '@/lib/floating-keep-clear';

/**
 * The live-update channel's state (the socket to the backend), not the AWS
 * connection: it shows on every page, connected to AWS or not, so it never
 * says "Connected". It floats as a fixed pill in the bottom-left corner of
 * every page (founder decision, Oct 26), so it can overlay content there
 * while scrolling. It never covers an element marked keep-clear (the
 * Dashboard cost trend legend, trend-lag round 2): while its resting box
 * overlaps one, it slides out to the left (still in the accessibility tree),
 * and it comes back once that element has scrolled clear.
 */
export function ConnectionIndicator() {
  const { isConnected } = useWebSocket();
  const label = isConnected ? 'Live updates' : 'Live updates paused';
  const ref = useRef<HTMLDivElement>(null);
  const [stepAside, setStepAside] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      // Its resting box: offsetLeft/Top ignore the slide transform, so the check never flickers.
      const left = el.offsetLeft;
      const top = el.offsetTop;
      setStepAside(coversKeepClear({ left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Content that loads or grows under a still page (the chart arriving) moves the legend too.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      resize?.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      aria-label={label}
      data-testid="connection-indicator"
      data-stepped-aside={stepAside ? 'true' : undefined}
      className={`fixed bottom-4 left-4 flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-label font-normal shadow-lg z-50 transition-transform duration-200 ${stepAside ? '-translate-x-[calc(100%+2rem)]' : 'translate-x-0'}`}
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
