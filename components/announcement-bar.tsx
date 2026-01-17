'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnnouncementBarProps {
  message: string;
  linkText?: string;
  linkHref?: string;
  dismissible?: boolean;
  storageKey?: string;
  variant?: 'default' | 'gradient' | 'subtle';
}

export function AnnouncementBar({
  message,
  linkText,
  linkHref,
  dismissible = true,
  storageKey = 'announcement-dismissed',
  variant = 'gradient',
}: AnnouncementBarProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if announcement was previously dismissed
    const isDismissed = localStorage.getItem(storageKey);
    setIsVisible(!isDismissed);
  }, [storageKey]);

  const handleDismiss = () => {
    localStorage.setItem(storageKey, 'true');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'relative',
        variant === 'gradient' &&
          'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white',
        variant === 'default' && 'bg-primary text-primary-foreground',
        variant === 'subtle' && 'bg-muted text-foreground border-b'
      )}
    >
      <div className="max-w-[1920px] mx-auto px-4 md:px-6 lg:px-8 py-2.5">
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="font-medium">{message}</span>
          {linkText && linkHref && (
            <Link
              href={linkHref}
              className={cn(
                'inline-flex items-center gap-1 font-semibold transition-colors',
                variant === 'gradient' && 'text-white/90 hover:text-white',
                variant === 'default' &&
                  'text-primary-foreground/90 hover:text-primary-foreground',
                variant === 'subtle' && 'text-primary hover:text-primary/80'
              )}
            >
              {linkText}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {dismissible && (
        <button
          onClick={handleDismiss}
          className={cn(
            'absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors',
            variant === 'gradient' && 'hover:bg-white/10',
            variant === 'default' && 'hover:bg-primary-foreground/10',
            variant === 'subtle' && 'hover:bg-muted-foreground/10'
          )}
          aria-label="Dismiss announcement"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
