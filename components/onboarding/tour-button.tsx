'use client';

import { HelpCircle, Play } from 'lucide-react';

interface TourButtonProps {
  onStartTour: () => void;
  variant?: 'icon' | 'button';
}

export function TourButton({ onStartTour, variant = 'button' }: TourButtonProps) {
  if (variant === 'icon') {
    return (
      <button
        onClick={onStartTour}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="Take a tour"
        aria-label="Take a tour"
      >
        <HelpCircle className="w-5 h-5" />
      </button>
    );
  }

  return (
    <button
      onClick={onStartTour}
      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      <Play className="w-4 h-4" />
      Take Tour
    </button>
  );
}
