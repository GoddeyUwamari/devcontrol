'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavGroup } from '@/lib/navigation-config';

interface NavDropdownProps {
  group: NavGroup;
  className?: string;
}

export function NavDropdown({ group, className = '' }: NavDropdownProps) {
  const pathname = usePathname();

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 px-3 py-2 text-base font-medium rounded-md transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isGroupActive ? 'text-foreground' : 'text-muted-foreground',
            className
          )}
        >
          {group.label}
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className={cn(
          'p-6 shadow-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950',
          isThreeColumn && 'w-[920px]',
          isTwoColumn && 'w-[640px]',
          !group.sections && 'w-[380px]'
        )}
        align="start"
        sideOffset={8}
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
                    <DropdownMenuLabel
                      className={cn(
                        'text-xs uppercase font-semibold tracking-wider px-2 pb-3',
                        isAI
                          ? 'text-purple-600 dark:text-purple-400'
                          : 'text-gray-500 dark:text-gray-400'
                      )}
                    >
                      {section.label}
                    </DropdownMenuLabel>
                  )}
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        pathname.startsWith(item.href + '/');
                      const Icon = item.icon;
                      const hasAIBadge =
                        item.badge === 'AI' || item.badge === 'New';

                      return (
                        <DropdownMenuItem
                          key={item.href}
                          asChild
                          className="p-0"
                        >
                          <Link
                            href={item.href}
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
                                    'w-4.5 h-4.5',
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
                        </DropdownMenuItem>
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
                <DropdownMenuItem key={item.href} asChild className="p-0">
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 w-full group',
                      'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                      isActive && 'bg-blue-50 dark:bg-blue-900/20'
                    )}
                  >
                    {Icon && (
                      <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                        <Icon className="w-4.5 h-4.5 text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
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
                </DropdownMenuItem>
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
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Get Started
              </Link>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
