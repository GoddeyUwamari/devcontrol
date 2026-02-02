'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavGroup } from '@/lib/navigation-config';

interface NavDropdownProps {
  group: NavGroup;
  className?: string;
}

export function NavDropdown({ group, className = '' }: NavDropdownProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if any item in the group is currently active
  const isGroupActive = React.useMemo(() => {
    const allItems = [
      ...(group.items || []),
      ...(group.sections?.flatMap((s) => s.items) || []),
    ];
    return allItems.some(
      (item) =>
        pathname === item.href || pathname.startsWith(item.href + '/')
    );
  }, [group, pathname]);

  // Determine number of columns based on sections
  const sectionCount = group.sections?.length || 0;
  const isThreeColumn = sectionCount >= 3;
  const isTwoColumn = sectionCount === 2;

  // Check if section is AI Features for special styling
  const isAISection = (label: string) => label.toLowerCase().includes('ai');

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Clear all timeouts
  const clearTimeouts = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  // Handle mouse enter - open after small delay
  const handleMouseEnter = useCallback(() => {
    if (isMobile) return;

    clearTimeouts();
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, 100); // 100ms delay prevents accidental triggers
  }, [isMobile, clearTimeouts]);

  // Handle mouse leave - close after small delay
  const handleMouseLeave = useCallback(() => {
    if (isMobile) return;

    clearTimeouts();
    leaveTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150); // 150ms delay gives user time to move to dropdown
  }, [isMobile, clearTimeouts]);

  // Handle click for mobile
  const handleClick = useCallback(() => {
    if (isMobile) {
      setIsOpen((prev) => !prev);
    }
  }, [isMobile]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => clearTimeouts();
  }, [clearTimeouts]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger Button */}
      <button
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={cn(
          'flex items-center gap-1 px-3 py-2 text-base font-medium rounded-md transition-all duration-200',
          'hover:bg-accent hover:text-accent-foreground',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isOpen && 'bg-accent text-accent-foreground',
          isGroupActive ? 'text-foreground' : 'text-muted-foreground',
          className
        )}
      >
        {group.label}
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 opacity-70 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown Content */}
      {isOpen && (
        <>
          {/* Invisible bridge to prevent gap issues */}
          <div className="absolute left-0 right-0 h-2" />

          <div
            className={cn(
              'absolute left-0 mt-2 bg-white dark:bg-gray-950 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6',
              'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200',
              isThreeColumn && 'w-[920px]',
              isTwoColumn && 'w-[640px]',
              !group.sections && 'w-[380px]'
            )}
            role="menu"
            aria-orientation="vertical"
          >
            {group.sections ? (
              // Multi-section dropdown (Platform, Solutions)
              <div
                className={cn(
                  'grid gap-8',
                  isThreeColumn && 'grid-cols-3',
                  isTwoColumn && 'grid-cols-2'
                )}
              >
                {group.sections.map((section, idx) => {
                  const isAI = isAISection(section.label);

                  return (
                    <div key={idx} className="space-y-1">
                      {section.label && (
                        <div
                          className={cn(
                            'text-xs uppercase font-semibold tracking-wider px-2 pb-3',
                            isAI
                              ? 'text-purple-600 dark:text-purple-400'
                              : 'text-gray-500 dark:text-gray-400'
                          )}
                        >
                          {section.label}
                        </div>
                      )}
                      <div className="space-y-1">
                        {section.items.map((item) => {
                          const isActive =
                            pathname === item.href ||
                            pathname.startsWith(item.href + '/');
                          const Icon = item.icon;

                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              role="menuitem"
                              onClick={() => setIsOpen(false)}
                              className={cn(
                                'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 w-full group',
                                'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                                isActive && 'bg-blue-50 dark:bg-blue-900/20'
                              )}
                            >
                              {Icon && (
                                <div
                                  className={cn(
                                    'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
                                    isAI
                                      ? 'bg-purple-100 dark:bg-purple-900/30 group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50'
                                      : 'bg-gray-100 dark:bg-gray-800 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30'
                                  )}
                                >
                                  <Icon
                                    className={cn(
                                      'w-4 h-4',
                                      isAI
                                        ? 'text-purple-600 dark:text-purple-400'
                                        : 'text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                                    )}
                                  />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-foreground flex items-center gap-2">
                                  {item.label}
                                  {item.badge && (
                                    <span
                                      className={cn(
                                        'px-1.5 py-0.5 text-[10px] font-semibold rounded',
                                        item.badge === 'New'
                                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                          : item.badge === 'AI'
                                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                      )}
                                    >
                                      {item.badge}
                                    </span>
                                  )}
                                </div>
                                {item.description && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed line-clamp-1">
                                    {item.description}
                                  </p>
                                )}
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              // Simple list dropdown (like Resources)
              <div className="space-y-1">
                {group.items?.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + '/');
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 w-full group',
                        'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                        isActive && 'bg-blue-50 dark:bg-blue-900/20'
                      )}
                    >
                      {Icon && (
                        <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                          <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-foreground">
                          {item.label}
                        </div>
                        {item.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Bottom CTA for Platform dropdown */}
            {group.label === 'Platform' && (
              <div className="mt-6 pt-5 border-t border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Ready to get started?
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Connect your AWS account in minutes
                    </p>
                  </div>
                  <Link
                    href="/settings/organization"
                    onClick={() => setIsOpen(false)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Get Started
                  </Link>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
