import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Timestamp utilities
export function getRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 120) return '1 minute ago';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 7200) return '1 hour ago';
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 172800) return '1 day ago';
  return `${Math.floor(seconds / 86400)} days ago`;
}

export function isDataStale(
  lastUpdated: Date | string,
  warningThresholdMinutes: number = 5,
  errorThresholdMinutes: number = 15
): 'fresh' | 'warning' | 'error' {
  const now = new Date();
  const then = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated;
  const minutes = Math.floor((now.getTime() - then.getTime()) / 1000 / 60);

  if (minutes >= errorThresholdMinutes) return 'error';
  if (minutes >= warningThresholdMinutes) return 'warning';
  return 'fresh';
}

// Cost utilities
export function annualizeMonthly(monthlyValue: number): number {
  return monthlyValue * 12
}

export function formatFullTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
